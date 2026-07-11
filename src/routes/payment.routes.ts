import { Router } from 'express';
import express from 'express';
import { paymentController } from '../controllers/payment.controller.js';
import { authenticate } from '../middleware/auth.js';
import { paymentRateLimit } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/initialize', authenticate, paymentRateLimit, paymentController.initialize);
router.get('/verify/:reference', authenticate, paymentController.verify);

router.post('/webhook/paystack', paymentController.paystackWebhook);
router.post('/webhook/skrill', express.urlencoded({ extended: true }), paymentController.skrillWebhook);

export default router;