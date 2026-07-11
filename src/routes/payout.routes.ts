import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { payoutService } from '../services/payout.service.js';

const router = Router();
router.use(authenticate);

router.get('/wallet', asyncHandler(async (req, res) => {
  const wallet = await payoutService.getWallet(req.user!.id);
  res.json({ success: true, wallet });
}));

router.get('/settings', asyncHandler(async (req, res) => {
  const settings = await payoutService.getSettings(req.user!.id);
  res.json({ success: true, ...settings });
}));

router.get('/history', asyncHandler(async (req, res) => {
  const history = await payoutService.getEarningsHistory(req.user!.id);
  res.json({ success: true, history });
}));

router.get('/paystack/banks', asyncHandler(async (req, res) => {
  const country = (req.query.country as 'ghana' | 'nigeria') ?? 'ghana';
  const banks = await payoutService.listPaystackBanks(country);
  res.json({ success: true, banks });
}));

router.post('/method', asyncHandler(async (req, res) => {
  const body = z.discriminatedUnion('method', [
    z.object({ method: z.literal('PAYSTACK_SUBACCOUNT'), bankCode: z.string().min(1), accountNumber: z.string().min(4), currency: z.string().length(3), reason: z.string().optional() }),
    z.object({ method: z.literal('SKRILL'), email: z.string().email(), reason: z.string().optional() }),
    z.object({ method: z.literal('GREY'), accountNumber: z.string().min(4), accountName: z.string().min(2), reason: z.string().optional() }),
  ]).parse(req.body);
  const { reason, ...input } = body;
  const result = await payoutService.requestPayoutMethodChange(req.user!.id, input, reason);
  res.json({ success: true, result });
}));

router.get('/change-requests', asyncHandler(async (req, res) => {
  const requests = await payoutService.getMyChangeRequests(req.user!.id);
  res.json({ success: true, requests });
}));

router.post('/frequency', asyncHandler(async (req, res) => {
  const { frequency } = z.object({
    frequency: z.enum(['WEEKLY', 'MONTHLY']),
  }).parse(req.body);
  const settings = await payoutService.setPayoutFrequency(req.user!.id, frequency);
  res.json({ success: true, ...settings });
}));

export default router;