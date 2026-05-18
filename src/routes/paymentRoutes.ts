import { Router } from 'express';
import {
  createCheckoutSession,
  handleWebhook,
  getOnboardingLink,
  getEarnings,
  savePayoutMethod,
} from '../controllers/paymentController.js';
import { protect, requireCreator } from '../middleware/auth.js';
import { validate, payoutSchema } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// POST /api/payments/checkout
// Creates a Stripe Checkout session — buyer must be logged in
router.post('/checkout', protect, asyncHandler(createCheckoutSession));

// POST /api/payments/webhook
// Stripe sends raw body — mounted with express.raw() in server.ts
router.post('/webhook', asyncHandler(handleWebhook));

// GET  /api/payments/onboard
// Returns Stripe Connect onboarding link for creator
router.get('/onboard', protect, requireCreator, asyncHandler(getOnboardingLink));

// GET  /api/payments/earnings
// Creator's earnings breakdown
router.get('/earnings', protect, requireCreator, asyncHandler(getEarnings));

// POST /api/payments/payout-method
// Save MoMo / bank / PayPal payout details
router.post(
  '/payout-method',
  protect,
  requireCreator,
  validate(payoutSchema),
  asyncHandler(savePayoutMethod)
);

export default router;