import crypto from 'crypto';
import prisma from '../db/prisma.js';
import logger from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { emailService } from './email.service.js';
import { paystackClient } from '../utils/paystack.client.js';
import { skrillClient } from '../utils/skrill.client.js';
import {
  getCommissionRate,
  isPaystackCurrency,
  isSkrillCurrency,
  resolveCheckoutProvider,
  toSubunit,
} from '../config/payments.config.js';

const BACKEND_URL = process.env.BACKEND_URL!; // must be a public HTTPS URL — used to build the Skrill status_url webhook target

export const paymentService = {

  async initializeCheckout(
    buyerId: string,
    data: {
      type: 'TEMPLATE' | 'PROJECT';
      referenceId: string;
      creatorId: string;
      amount: number;
      currency: string;
      email: string;
      callbackUrl: string; // base return URL, e.g. https://flowva.../payment-callback.html
    },
  ) {
    // Buyer's country decides the checkout provider — pulled from the
    // buyer's own account record, never from client input, so a buyer
    // can't spoof which processor (and fee/currency handling) applies.
    const buyer = await prisma.user.findUnique({ where: { id: buyerId }, select: { country: true, email: true } });
    if (!buyer) throw new AppError('Buyer account not found', 404);

    const provider = resolveCheckoutProvider(buyer.country);

    if (provider === 'PAYSTACK' && !isPaystackCurrency(data.currency)) {
      throw new AppError(`Payment currency ${data.currency} is not currently supported.`, 400);
    }
    if (provider === 'SKRILL' && !isSkrillCurrency(data.currency)) {
      throw new AppError(`Payment currency ${data.currency} is not currently supported.`, 400);
    }

    const commissionRate   = await getCreatorCommissionRate(data.creatorId);
    const commissionAmount = parseFloat((data.amount * commissionRate).toFixed(2));
    const creatorEarning   = parseFloat((data.amount - commissionAmount).toFixed(2));

    const order = await prisma.order.create({
      data: {
        buyerId,
        creatorId:       data.creatorId,
        mongoTemplateId: data.type === 'TEMPLATE' ? data.referenceId : undefined,
        mongoBidId:      data.type === 'PROJECT'  ? data.referenceId : undefined,
        type:            data.type === 'TEMPLATE' ? 'TEMPLATE_PURCHASE' : 'PROJECT_DELIVERY',
        amount:          data.amount,
        currency:        data.currency,
        status:          'PENDING',
      },
    });

    const reference = `FLW_${order.id}`;
    // Always pass the order id explicitly on return — the frontend should
    // never have to guess which order a redirect belongs to.
    const returnUrl = appendQuery(data.callbackUrl, { orderId: order.id });
    const cancelUrl = appendQuery(data.callbackUrl, { orderId: order.id, status: 'cancelled' });

    let authorizationUrl: string;

    if (provider === 'PAYSTACK') {
      let init;
      try {
        init = await paystackClient.initializeTransaction({
          email:        data.email,
          amount:       toSubunit(data.amount),
          currency:     data.currency,
          reference,
          callback_url: returnUrl,
          metadata: { orderId: order.id, buyerId, creatorId: data.creatorId, type: data.type },
        });
      } catch (err: any) {
        logger.error('Paystack initialize failed', { status: err.response?.status, detail: err.response?.data });
        throw new AppError('Payment system unavailable. Please try again.', 502);
      }
      if (!init?.authorization_url) {
        logger.error('Paystack initialize missing authorization_url', { init });
        throw new AppError('Could not create checkout. Please try again.', 502);
      }
      authorizationUrl = init.authorization_url;
    } else {
      const init = skrillClient.buildCheckoutUrl({
        transactionId: reference,
        amount:        data.amount,
        currency:      data.currency,
        buyerEmail:    data.email,
        returnUrl,
        cancelUrl,
        statusUrl:     `${BACKEND_URL}/api/payments/webhook/skrill`,
        description:   data.type === 'TEMPLATE' ? 'Template purchase' : 'Project payment',
      });
      authorizationUrl = init.authorizationUrl;
    }

    await prisma.payment.create({
      data: {
        orderId:     order.id,
        userId:      buyerId,
        provider,
        providerRef: reference,
        amount:      data.amount,
        currency:    data.currency,
        status:      'PENDING',
        metadata:    { creatorEarning, commissionAmount },
      },
    });

    logger.info(`${provider} transaction initialized`, { orderId: order.id, reference, provider });

    return { authorizationUrl, reference, orderId: order.id, provider };
  },

  /**
   * Accepts either the provider reference (FLW_<orderId>) or the bare
   * order id — the frontend should send orderId, but this stays tolerant
   * of older links / callers that only have the reference.
   */
  async verifyPayment(refOrOrderId: string) {
    let payment = await prisma.payment.findUnique({ where: { providerRef: refOrOrderId } });
    if (!payment) {
      payment = await prisma.payment.findUnique({ where: { orderId: refOrOrderId } });
    }
    if (!payment) throw new AppError('Payment not found', 404);

    if (payment.status === 'SUCCESS') {
      const order = await prisma.order.findUnique({ where: { id: payment.orderId }, select: { mongoTemplateId: true } });
      return { verified: true, templateId: order?.mongoTemplateId ?? null };
    }

    if (payment.provider === 'PAYSTACK') {
      // Active re-check in case buyer polls before the webhook lands.
      try {
        const result = await paystackClient.verifyTransaction(payment.providerRef);
        if (result?.status === 'success') {
          await settlePayment(payment.orderId, payment.providerRef, `poll_${payment.providerRef}`);
          const order = await prisma.order.findUnique({ where: { id: payment.orderId }, select: { mongoTemplateId: true } });
          return { verified: true, templateId: order?.mongoTemplateId ?? null };
        }
      } catch (err: any) {
        logger.warn('Paystack verify poll failed', { reference: payment.providerRef, error: err.message });
      }
    }
    // Skrill Quick Checkout has no synchronous verify-by-reference endpoint —
    // confirmation only ever arrives via the status_url webhook. Polling
    // here can only report current DB state, not force an early settle.

    return { verified: false, templateId: null };
  },

  async handlePaystackWebhook(rawBody: Buffer, signature: string) {
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(rawBody).digest('hex');
    if (hash !== signature) {
      logger.warn('Paystack webhook signature mismatch');
      throw new AppError('Invalid webhook signature', 401);
    }

    const event = JSON.parse(rawBody.toString());
    logger.info('Paystack webhook received', { event: event.event });

    if (event.event !== 'charge.success') {
      logger.info('Paystack webhook ignored', { eventType: event.event });
      return;
    }

    const reference = event.data?.reference as string | undefined;
    if (!reference) return;

    const eventId = `paystack_${reference}`;
    const existing = await prisma.processedWebhook.findUnique({ where: { eventId } });
    if (existing) return;
    await prisma.processedWebhook.create({ data: { eventId, provider: 'PAYSTACK' } });

    const payment = await prisma.payment.findUnique({ where: { providerRef: reference } });
    if (!payment) { logger.warn('Paystack webhook: no matching payment', { reference }); return; }

    await settlePayment(payment.orderId, reference, eventId);
  },

  /**
   * Skrill posts application/x-www-form-urlencoded to status_url — the
   * controller must parse it with express.urlencoded() (not JSON) and pass
   * the parsed body straight through here. Signature check happens before
   * any DB write.
   */
  async handleSkrillWebhook(body: Record<string, string>) {
    if (!skrillClient.verifyWebhookSignature(body)) {
      logger.warn('Skrill webhook signature mismatch', { transactionId: body.transaction_id });
      throw new AppError('Invalid webhook signature', 401);
    }

    logger.info('Skrill webhook received', { status: body.status, transactionId: body.transaction_id });

    // Skrill status codes: 2 = processed/success, 0 = pending, -1/-2 = failed/cancelled.
    if (body.status !== '2') {
      logger.info('Skrill webhook ignored', { status: body.status });
      return;
    }

    const reference = body.transaction_id;
    if (!reference) return;

    const eventId = `skrill_${reference}_${body.mb_transaction_id ?? ''}`;
    const existing = await prisma.processedWebhook.findUnique({ where: { eventId } });
    if (existing) return;
    await prisma.processedWebhook.create({ data: { eventId, provider: 'SKRILL' } });

    const payment = await prisma.payment.findUnique({ where: { providerRef: reference } });
    if (!payment) { logger.warn('Skrill webhook: no matching payment', { reference }); return; }

    // Defense in depth: confirm the amount Skrill reports matches what we
    // recorded at checkout init, in case of a tampered/replayed request.
    const reportedAmount = parseFloat(body.mb_amount ?? body.amount ?? '0');
    if (Math.abs(reportedAmount - Number(payment.amount)) > 0.01) {
      logger.error('Skrill webhook amount mismatch', { reference, expected: payment.amount, reported: reportedAmount });
      return;
    }

    await settlePayment(payment.orderId, reference, eventId);
  },
};

function appendQuery(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

async function settlePayment(orderId: string, providerRef: string, webhookEventId: string) {
  const existing = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!existing) { logger.warn('settlePayment: not found', { orderId }); return; }
  if (existing.status !== 'PENDING') { logger.info('settlePayment: already settled', { orderId }); return; }

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { creator: true, buyer: true } });
  if (!order) return;

  const isTemplate       = order.type === 'TEMPLATE_PURCHASE';
  const commissionRate   = await getCreatorCommissionRate(order.creatorId);
  const commissionAmount = parseFloat((Number(order.amount) * commissionRate).toFixed(2));
  const creatorEarning   = parseFloat((Number(order.amount) - commissionAmount).toFixed(2));

  await prisma.$transaction(async tx => {
    const locked = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!locked || locked.status !== 'PENDING') return;

    await tx.payment.update({ where: { providerRef }, data: { status: 'SUCCESS', webhookEventId } });

    await tx.order.update({
      where: { id: orderId },
      data: { status: isTemplate ? 'COMPLETED' : 'PAID', completedAt: isTemplate ? new Date() : undefined },
    });

    await tx.escrow.create({
      data: {
        orderId, amount: order.amount, currency: order.currency,
        status: isTemplate ? 'RELEASED' : 'HELD',
        releasedAt: isTemplate ? new Date() : undefined,
      },
    });

    const existingCommission = await tx.commission.findUnique({ where: { orderId } });
    if (!existingCommission) {
      await tx.commission.create({
        data: {
          orderId, creatorId: order.creatorId, grossAmount: order.amount,
          commissionRate, commissionAmount, creatorEarning,
          disbursedToAdmin: true, disbursedAt: new Date(),
        },
      });
    }

    // Every buyer payment lands 100% in Flowva's own Paystack or Skrill
    // business account — no split at charge time, regardless of which
    // provider processed the buyer's payment. Creator earnings accrue here
    // and only clear once admin actually pays out (Paystack transfer, or
    // manual Skrill/Grey marked paid) — see payout.service.ts.
    await tx.creatorWallet.upsert({
      where:  { userId: order.creatorId },
      create: { userId: order.creatorId, totalEarned: creatorEarning, pending: creatorEarning },
      update: { totalEarned: { increment: creatorEarning }, pending: { increment: creatorEarning } },
    });

    if (!isTemplate) {
      await tx.notification.create({
        data: {
          userId:  order.creatorId,
          type:    'ESCROW_FUNDED',
          title:   'Payment received — you can start work',
          message: 'The client has funded escrow for the project. Deliver by the agreed deadline.',
        },
      });
    }
  }, { timeout: 30_000 });

  if (isTemplate && order.mongoTemplateId) {
    const { templateService } = await import('./template.service.js');
    await templateService.recordPurchase(order.mongoTemplateId).catch(err => logger.warn('recordPurchase failed', { error: err.message }));
  }

  if (order.buyer?.email) {
    await emailService.orderConfirmation(order.buyer.email, order.id, Number(order.amount), order.currency).catch(() => {});
  }

  if (order.creator?.email) {
    let templateTitle = 'Template';
    if (order.mongoTemplateId) {
      const { templateService } = await import('./template.service.js');
      const tmpl = await templateService.getById(order.mongoTemplateId).catch(() => null);
      if (tmpl) templateTitle = (tmpl as any).title;
    }
    await emailService.saleMade(order.creator.email, order.creator.name, templateTitle, Number(order.amount), creatorEarning, order.currency).catch(() => {});
  }

  logger.info('Payment settled', { orderId, type: order.type, amount: order.amount, creatorEarning, commissionAmount });
}

async function getCreatorCommissionRate(creatorId: string): Promise<number> {
  const creator = await prisma.user.findUnique({ where: { id: creatorId }, select: { isEarlyAdopter: true } });
  return getCommissionRate(creator?.isEarlyAdopter ?? false);
}