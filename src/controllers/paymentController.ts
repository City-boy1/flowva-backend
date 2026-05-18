import type { Request, Response } from 'express';
import type { AuthRequest } from '../types/index.js';
import Stripe from 'stripe';
import prisma from '../db/prisma.js';
import { Template, User, Notification } from '../db/mongoose.js';
import logger from '../utils/logger.js';
import { sendPurchaseConfirmation, sendSaleNotification } from '../services/emailService.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const CREATOR_SHARE  = parseFloat(process.env.CREATOR_SHARE ?? '0.70');
const PLATFORM_SHARE = 1 - CREATOR_SHARE;

// ── CREATE CHECKOUT SESSION ────────────────────────────
export async function createCheckoutSession(req: AuthRequest, res: Response): Promise<void> {
  const { templateId } = req.body as { templateId: string };

  const template = await Template.findById(templateId);
  if (!template) {
    res.status(404).json({ success: false, message: 'Template not found' });
    return;
  }

  const creator = await User.findById(template.creator);
  if (!creator) {
    res.status(404).json({ success: false, message: 'Creator not found' });
    return;
  }

  const amountCents   = Math.round(template.price * 100);
  const creatorCents  = Math.round(amountCents * CREATOR_SHARE);
  const platformCents = amountCents - creatorCents;

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5500';

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode:                 'payment',
    line_items: [{
      price_data: {
        currency:     'usd',
        product_data: {
          name:        template.title,
          description: template.description.slice(0, 200),
          images:      [template.thumbnailUrl],
        },
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    metadata: {
      templateId:   templateId,
      buyerId:      req.user!.id,
      creatorId:    template.creator.toString(),
      creatorCents: creatorCents.toString(),
      platformCents: platformCents.toString(),
    },
    success_url: `${frontendUrl}/dashboard.html?purchase=success&template=${templateId}`,
    cancel_url:  `${frontendUrl}/marketplace.html?purchase=cancelled`,

    // Auto-transfer to creator's connected account if they have one
    ...(creator.stripeAccountId ? {
      payment_intent_data: {
        transfer_data: {
          destination: creator.stripeAccountId,
          amount:      creatorCents,
        },
      },
    } : {}),
  });

  res.json({ success: true, data: { sessionId: session.id, url: session.url } });
}

// ── STRIPE WEBHOOK ────────────────────────────────────
// Mount with express.raw() — NOT express.json()
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: unknown) {
    logger.warn('Webhook signature verification failed', err);
    res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    return;
  }

  // Idempotency — skip if already processed
  const existing = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
  if (existing?.processed) {
    res.json({ success: true, message: 'Already processed' });
    return;
  }

  // Record the event
  await prisma.webhookEvent.upsert({
    where:  { id: event.id },
    create: { id: event.id, type: event.type },
    update: {},
  });

  if (event.type === 'checkout.session.completed') {
    await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data:  { processed: true },
    });
  }

  res.json({ success: true });
}

async function handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
  const { templateId, buyerId, creatorId, creatorCents, platformCents } = session.metadata!;

  const template = await Template.findById(templateId);
  if (!template) {
    logger.error(`Webhook: template ${templateId} not found`);
    return;
  }

  // Resolve Postgres user IDs from MongoDB IDs
  const [buyerPg, creatorPg] = await Promise.all([
    prisma.user.findUnique({ where: { mongoId: buyerId } }),
    prisma.user.findUnique({ where: { mongoId: creatorId } }),
  ]);

  if (!buyerPg || !creatorPg) {
    logger.error(`Webhook: user not found in Postgres buyerId=${buyerId} creatorId=${creatorId}`);
    return;
  }

  // Use a transaction — if any step fails, nothing is committed
  await prisma.$transaction(async (tx) => {
    await tx.order.create({
      data: {
        stripePaymentId: session.payment_intent as string,
        stripeSessionId: session.id,
        buyerId:         buyerPg.id,
        creatorId:       creatorPg.id,
        templateMongoId: templateId,
        templateTitle:   template.title,
        amountTotal:     session.amount_total ?? 0,
        creatorAmount:   parseInt(creatorCents),
        platformAmount:  parseInt(platformCents),
        status:          'PAID',
        downloadUrl:     template.downloadUrl,
      },
    });
  });

  // Update MongoDB template sales counter
  await Template.findByIdAndUpdate(templateId, { $inc: { sales: 1 } });

  // Update creator revenue in MongoDB
  await User.findByIdAndUpdate(creatorId, {
    $inc: {
      totalSales:   1,
      totalRevenue: parseInt(creatorCents) / 100,
    },
  });

  // Create notification for creator
  await Notification.create({
    userId: creatorId,
    icon:   '💰',
    text:   `"${template.title}" was purchased — you earned $${(parseInt(creatorCents) / 100).toFixed(2)}`,
  });

  // Send emails (fire-and-forget — don't block the webhook response)
  const buyer   = await User.findById(buyerId).select('name email');
  const creator = await User.findById(creatorId).select('name email');

  if (buyer) {
    sendPurchaseConfirmation({
      buyerEmail:    buyer.email,
      buyerName:     buyer.name,
      templateTitle: template.title,
      downloadUrl:   template.downloadUrl,
      amount:        (session.amount_total ?? 0) / 100,
    }).catch(err => logger.error('Purchase email failed', err));
  }

  if (creator) {
    sendSaleNotification({
      creatorEmail:  creator.email,
      creatorName:   creator.name,
      templateTitle: template.title,
      creatorEarns:  parseInt(creatorCents) / 100,
    }).catch(err => logger.error('Sale notification email failed', err));
  }

  logger.info(`Order created: template="${template.title}" buyer=${buyerId} creator=${creatorId}`);
}

// ── STRIPE CONNECT ONBOARDING ─────────────────────────
export async function getOnboardingLink(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  let accountId = user.stripeAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type:  'express',
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers:     { requested: true },
      },
    });
    accountId = account.id;
    user.stripeAccountId = accountId;
    await user.save();

    await prisma.user.update({
      where: { mongoId: user._id.toString() },
      data:  { stripeAccountId: accountId },
    });
  }

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5500';

  const link = await stripe.accountLinks.create({
    account:     accountId,
    refresh_url: `${frontendUrl}/dashboard.html#payout`,
    return_url:  `${frontendUrl}/dashboard.html#payout`,
    type:        'account_onboarding',
  });

  res.json({ success: true, data: { url: link.url } });
}

// ── GET CREATOR EARNINGS ──────────────────────────────
export async function getEarnings(req: AuthRequest, res: Response): Promise<void> {
  const pgUser = await prisma.user.findUnique({ where: { mongoId: req.user!.id } });
  if (!pgUser) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  const [paid, pending] = await Promise.all([
    prisma.order.aggregate({
      where:  { creatorId: pgUser.id, status: 'PAID' },
      _sum:   { creatorAmount: true },
      _count: { id: true },
    }),
    prisma.payout.aggregate({
      where:  { creatorId: pgUser.id, status: 'PENDING' },
      _sum:   { amount: true },
    }),
  ]);

  res.json({
    success: true,
    data: {
      totalEarned:  (paid._sum.creatorAmount ?? 0) / 100,
      totalSales:    paid._count.id,
      pendingPayout: (pending._sum.amount ?? 0) / 100,
    },
  });
}

// ── SAVE PAYOUT METHOD ────────────────────────────────
export async function savePayoutMethod(req: AuthRequest, res: Response): Promise<void> {
  const { method, account, name } = req.body as {
    method: string; account: string; name: string;
  };

  await User.findByIdAndUpdate(req.user!.id, {
    payoutMethod:  method,
    payoutAccount: account,
    payoutName:    name,
  });

  res.json({ success: true, message: 'Payout details saved' });
}