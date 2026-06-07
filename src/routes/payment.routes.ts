import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller.js';
import { authenticate } from '../middleware/auth.js';
import { paymentRateLimit } from '../middleware/rateLimiter.js';

const router = Router();

// Authenticated routes
router.post('/initialize', authenticate, paymentRateLimit, paymentController.initialize);
router.get('/verify/:reference',  authenticate, paymentController.verify);

// Webhook — NO auth (Helio calls this directly, signature verified inside service)
router.post('/webhook/helio', paymentController.helioWebhook);

export default router;