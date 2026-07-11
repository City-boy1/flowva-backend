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
  initialize: asyncHandler(async (req: Request, res: Response) => {
    const data = initSchema.parse(req.body);
    const result = await paymentService.initializeCheckout(req.user!.id, { ...data, email: req.user!.email });
    res.json({ success: true, ...result });
  }),

  verify: asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentService.verifyPayment(req.params.reference);
    res.json({ success: true, ...result });
  }),

  paystackWebhook: asyncHandler(async (req: Request, res: Response) => {
    const signature = (req.headers['x-paystack-signature'] ?? '') as string;
    res.sendStatus(200); // ack immediately — Paystack retries on non-200
    paymentService.handlePaystackWebhook(req.body as Buffer, signature)
      .catch(err => logger.error('Webhook processing failed', { message: err.message }));
  }),
};