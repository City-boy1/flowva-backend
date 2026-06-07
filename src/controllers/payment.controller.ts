import type { Request, Response } from 'express';
import { z } from 'zod';
import { paymentService } from '../services/payment.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../utils/logger.js';

const initSchema = z.object({
  type:        z.enum(['TEMPLATE', 'PROJECT']),
  referenceId: z.string(),
  creatorId:   z.string(),
  amount:      z.number().positive(),
  currency:    z.string().default('USD'),
  callbackUrl: z.string().url(),
});

export const paymentController = {

  // POST /api/payments/initialize
  // Buyer initiates checkout — returns a Helio pay link URL
  initialize: asyncHandler(async (req: Request, res: Response) => {
    const data = initSchema.parse(req.body);
    const result = await paymentService.initializeCheckout(req.user!.id, {
      ...data,
      email: req.user!.email,
    });
    res.json({ success: true, ...result });
  }),

  // GET /api/payments/verify/:reference
  // Buyer polls this after returning from Helio checkout
  verify: asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentService.verifyPayment(req.params.reference);
    res.json({ success: true, ...result });
  }),

  // POST /api/payments/webhook/helio
  // Helio calls this when payment is confirmed on-chain
  // Raw body is preserved in server.ts for signature verification
  helioWebhook: asyncHandler(async (req: Request, res: Response) => {
    const sig = (
      req.headers['helio-signature'] ??
      req.headers['x-helio-signature'] ??
      req.headers['x-webhook-signature'] ??
      ''
    ) as string;

    // Respond 200 immediately so Helio doesn't retry
    res.sendStatus(200);

    // Process asynchronously after responding
    paymentService.handleHelioWebhook(req.body as Buffer, sig)
      .catch(err => logger.error('Webhook processing failed', { message: err.message }));
  }),
};