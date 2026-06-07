import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/signup', authRateLimit, authController.signup);
router.post('/login', authRateLimit, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/forgot-password', authRateLimit, authController.forgotPassword);
router.post('/reset-password', authRateLimit, authController.resetPassword);
router.get('/me', authenticate, authController.me);
router.post('/resend-verification', authRateLimit, authController.resendVerification);

export default router;