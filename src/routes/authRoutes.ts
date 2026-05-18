import { Router } from 'express';
import { register, login, refreshToken, logout, getMe } from '../controllers/authController.js';
import { validate, registerSchema, loginSchema } from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// POST /api/auth/register
router.post('/register', authLimiter, validate(registerSchema), asyncHandler(register));

// POST /api/auth/login
router.post('/login',    authLimiter, validate(loginSchema),    asyncHandler(login));

// POST /api/auth/refresh  (uses httpOnly refresh cookie)
router.post('/refresh',  asyncHandler(refreshToken));

// POST /api/auth/logout
router.post('/logout',   asyncHandler(logout));

// GET  /api/auth/me  (requires access token)
router.get('/me', protect, asyncHandler(getMe));

export default router;