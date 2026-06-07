import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { payoutService } from '../services/payout.service.js';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

// GET /api/payouts/wallet
// Creator's dashboard earnings display (totalEarned + pending)
router.get('/wallet', asyncHandler(async (req, res) => {
  const wallet = await payoutService.getWallet(req.user!.id);
  res.json({ success: true, wallet });
}));

// GET /api/payouts/settings
// Creator's saved wallet address
router.get('/settings', asyncHandler(async (req, res) => {
  const settings = await payoutService.getSettings(req.user!.id).catch(() => null);
  res.json({ success: true, settings });
}));

// PUT /api/payouts/settings
// Creator updates their wallet address from dashboard
router.put('/settings', asyncHandler(async (req, res) => {
  const { solanaAddress } = z.object({
    solanaAddress: z.string().min(32).max(44),
  }).parse(req.body);
  const settings = await payoutService.updateWalletAddress(req.user!.id, solanaAddress);
  res.json({ success: true, settings });
}));

// GET /api/payouts/history
// Creator's earnings history from Commission records
router.get('/history', asyncHandler(async (req, res) => {
  const history = await payoutService.getEarningsHistory(req.user!.id);
  res.json({ success: true, history });
}));

export default router;