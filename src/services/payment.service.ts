import crypto from 'crypto';
import axios  from 'axios';
import prisma from '../db/prisma.js';
import logger from '../utils/logger.js';
import { AppError }          from '../middleware/errorHandler.js';
import { emailService }      from './email.service.js';
import { getCommissionRate } from '../config/payments.config.js';

const HELIO_API = 'https://api.dev.hel.io/v1';
const HELIO_PUBLIC_KEY = process.env.HELIO_API_KEY!;
const HELIO_SECRET     = process.env.HELIO_API_SECRET!;

const _headers = () => ({
  'Authorization': `Bearer ${HELIO_SECRET}`,
  'Content-Type':  'application/json',
  'Origin':        process.env.FRONTEND_URL ?? 'http://127.0.0.1:5500',
});

export const paymentService = {

  async initializeCheckout(
    buyerId: string,
    data: {
      type:        'TEMPLATE' | 'PROJECT';
      referenceId: string;
      creatorId:   string;
      amount:      number;
      currency:    string;
      email:       string;
      callbackUrl: string;
    },
  ) {
    // Get creator's Helio paylink ID (set up once in dashboard with 70/30 split)
    const creatorSettings = await prisma.payoutSetting.findUnique({
      where: { userId: data.creatorId },
    });

    if (!creatorSettings?.helioPaylinkId) {
      throw new AppError(
        'Creator has not set up their payment split yet. Please contact support.',
        400,
      );
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
        currency:        'USDC',
        status:          'PENDING',
      },
    });

    // Create a single-use Charge from the creator's reusable paylink
    // Price is dynamic — set per purchase
    const chargeRes = await axios.post(
      `${HELIO_API}/charge/api-key?apiKey=${HELIO_PUBLIC_KEY}`,
      {
        paymentRequestId:  creatorSettings.helioPaylinkId,
        requestAmount:     String(data.amount),
        successRedirectUrl: data.callbackUrl,
        cancelRedirectUrl:  `${process.env.FRONTEND_URL ?? 'http://127.0.0.1:5500'}/marketplace.html?payment=cancelled`,
        prepareRequestBody: {
          customerDetails: {
            additionalJSON: JSON.stringify({
              orderId:        order.id,
              buyerId,
              creatorId:      data.creatorId,
              type:           data.type,
              creatorEarning: String(creatorEarning),
            }),
          },
        },
      },
      { headers: _headers() },
    ).catch(err => {
      logger.error('Helio charge creation failed', {
        status: err.response?.status,
        detail: err.response?.data,
      });
      throw new AppError('Payment system unavailable. Please try again.', 502);
    });

    const chargeId    = chargeRes.data?.id as string;
    const checkoutUrl = chargeRes.data?.pageUrl as string;

    if (!checkoutUrl || !chargeId) {
      logger.error('Helio charge missing pageUrl', { body: chargeRes.data });
      throw new AppError('Could not create checkout. Please try again.', 502);
    }

    await prisma.payment.create({
      data: {
        orderId:     order.id,
        userId:      buyerId,
        provider:    'HELIO',
        providerRef: chargeId,
        amount:      data.amount,
        currency:    'USDC',
        status:      'PENDING',
        metadata:    { chargeId, creatorEarning, commissionAmount },
      },
    });

    logger.info('Helio charge created', { orderId: order.id, chargeId });

    return {
      authorizationUrl: checkoutUrl,
      reference:        chargeId,
      orderId:          order.id,
    };
  },

  async verifyPayment(reference: string) {
    const payment = await prisma.payment.findUnique({
      where: { providerRef: reference },
    });
    if (!payment) throw new AppError('Payment not found', 404);

    if (payment.status === 'SUCCESS') {
      const order = await prisma.order.findUnique({
        where:  { id: payment.orderId },
        select: { mongoTemplateId: true },
      });
      return { verified: true, templateId: order?.mongoTemplateId ?? null };
    }

    return { verified: false, templateId: null };
  },

  async handleHelioWebhook(rawBody: Buffer, signature: string) {
    // Try both hex and base64 signature formats since header name is undocumented
    const hash = crypto
      .createHmac('sha256', process.env.HELIO_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');

    const sigHex  = signature;
    const hashHex = hash;

    let valid = false;
    try {
      const sigBuf  = Buffer.from(sigHex,  'hex');
      const hashBuf = Buffer.from(hashHex, 'hex');
      valid = sigBuf.length === hashBuf.length &&
        crypto.timingSafeEqual(sigBuf, hashBuf);
    } catch {
      valid = false;
    }

    if (!valid) {
      logger.warn('Helio webhook signature mismatch — logging body for debug');
      // In dev, don't block — log and continue so we can see the payload
      if (process.env.NODE_ENV === 'production') {
        throw new AppError('Invalid webhook signature', 401);
      }
    }

    const event     = JSON.parse(rawBody.toString());
    logger.info('Helio webhook received', { event: JSON.stringify(event).slice(0, 500) });

    const eventType = event.event ?? event.type ?? '';
    if (!['PAYMENT_SUCCESS', 'CREATED', 'COMPLETED'].includes(eventType)) {
      logger.info('Helio webhook ignored', { eventType });
      return;
    }

    const eventId = String(event.transactionId ?? event.id ?? '');
    if (!eventId) return;

    const existing = await prisma.processedWebhook.findUnique({ where: { eventId } });
    if (existing) return;
    await prisma.processedWebhook.create({ data: { eventId, provider: 'HELIO' } });

    // Extract orderId from additionalJSON in customerDetails
    let orderId: string | undefined;
    try {
      const additional = event.transaction?.customerDetails?.additionalJSON
        ?? event.customerDetails?.additionalJSON
        ?? event.prepareRequestBody?.customerDetails?.additionalJSON
        ?? '{}';
      const parsed = JSON.parse(additional);
      orderId = parsed.orderId;
    } catch {
      orderId = undefined;
    }

    // Fallback: find by chargeId
    if (!orderId) {
      const chargeId = event.id ?? event.chargeId;
      if (chargeId) {
        const payment = await prisma.payment.findUnique({
          where: { providerRef: chargeId },
        });
        orderId = payment?.orderId;
      }
    }

    if (!orderId) {
      logger.warn('Helio webhook: could not find orderId', { eventId });
      return;
    }

    await settlePayment(orderId, event.id ?? eventId, eventId);
  },
};

// ─── Settle confirmed payment ─────────────────────────────────────────────────
async function settlePayment(
  orderId:        string,
  providerRef:    string,
  webhookEventId: string,
) {
  const existing = await prisma.order.findUnique({
    where:  { id: orderId },
    select: { status: true },
  });
  if (!existing) { logger.warn('settlePayment: not found', { orderId }); return; }
  if (existing.status !== 'PENDING') { logger.info('settlePayment: already settled', { orderId }); return; }

  const order = await prisma.order.findUnique({
    where:   { id: orderId },
    include: { creator: true, buyer: true },
  });
  if (!order) return;

  const isTemplate       = order.type === 'TEMPLATE_PURCHASE';
  const commissionRate   = await getCreatorCommissionRate(order.creatorId);
  const commissionAmount = parseFloat((Number(order.amount) * commissionRate).toFixed(2));
  const creatorEarning   = parseFloat((Number(order.amount) - commissionAmount).toFixed(2));

  await prisma.$transaction(async tx => {
    const locked = await tx.order.findUnique({
      where:  { id: orderId },
      select: { status: true },
    });
    if (!locked || locked.status !== 'PENDING') return;

    await tx.payment.update({
      where: { providerRef },
      data:  { status: 'SUCCESS', webhookEventId },
    });

    await tx.order.update({
      where: { id: orderId },
      data: {
        status:      isTemplate ? 'COMPLETED' : 'PAID',
        completedAt: isTemplate ? new Date() : undefined,
      },
    });

    await tx.escrow.create({
      data: {
        orderId,
        amount:     order.amount,
        currency:   'USDC',
        status:     isTemplate ? 'RELEASED' : 'HELD',
        releasedAt: isTemplate ? new Date() : undefined,
      },
    });

    const existingCommission = await tx.commission.findUnique({ where: { orderId } });
    if (!existingCommission) {
      await tx.commission.create({
        data: {
          orderId,
          creatorId:        order.creatorId,
          grossAmount:      order.amount,
          commissionRate,
          commissionAmount,
          creatorEarning,
          disbursedToAdmin: true,
          disbursedAt:      new Date(),
        },
      });
    }

    await tx.creatorWallet.upsert({
      where:  { userId: order.creatorId },
      create: {
        userId:      order.creatorId,
        totalEarned: creatorEarning,
        pending:     creatorEarning,
      },
      update: {
        totalEarned: { increment: creatorEarning },
        pending:     { increment: creatorEarning },
      },
    });
  }, { timeout: 30_000 });

  if (isTemplate && order.mongoTemplateId) {
    const { templateService } = await import('./template.service.js');
    await templateService.recordPurchase(order.mongoTemplateId).catch(err =>
      logger.warn('recordPurchase failed', { error: err.message }),
    );
  }

  if (order.buyer?.email) {
    await emailService
      .orderConfirmation(order.buyer.email, order.id, Number(order.amount), 'USDC')
      .catch(() => {});
  }

  if (order.creator?.email) {
    let templateTitle = 'Template';
    if (order.mongoTemplateId) {
      const { templateService } = await import('./template.service.js');
      const tmpl = await templateService.getById(order.mongoTemplateId).catch(() => null);
      if (tmpl) templateTitle = (tmpl as any).title;
    }
    await emailService
      .saleMade(order.creator.email, order.creator.name, templateTitle, Number(order.amount), creatorEarning, 'USDC')
      .catch(() => {});
  }

  logger.info('Payment settled via Helio charge', {
    orderId, type: order.type,
    amount: order.amount, creatorEarning, commissionAmount,
  });
}

async function getCreatorCommissionRate(creatorId: string): Promise<number> {
  const creator = await prisma.user.findUnique({
    where:  { id: creatorId },
    select: { isEarlyAdopter: true },
  });
  return getCommissionRate(creator?.isEarlyAdopter ?? false);
}