import type { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import prisma from '../db/prisma.js';

const phoneSchema = z.string()
  .min(7, 'Phone number is too short')
  .max(20, 'Phone number is too long')
  .regex(/^[+0-9\s-]{7,20}$/, 'Invalid phone number format')
  .trim();

const signupSchema = z.discriminatedUnion('role', [
  // ── BUYER signup — no wallet needed ─────────────────────────────────────────
  z.object({
    role:     z.literal('BUYER'),
    name:     z.string().min(2).max(80).trim(),
    email:    z.string().email().toLowerCase(),
    password: z.string().min(6).max(100),
    country:  z.string().min(2).max(60).default('ghana'),
  }),

  z.object({
    role:     z.literal('CREATOR'),
    name:     z.string().min(2).max(80).trim(),
    email:    z.string().email().toLowerCase(),
    password: z.string().min(6).max(100),
    country:  z.string().min(2).max(60).default('ghana'),
    phone:    phoneSchema,
  }),
]);

const loginSchema = z.object({
  email:    z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const isProd = process.env.NODE_ENV === 'production';

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   isProd,
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000,
  path:     '/',
};

export const authController = {

  signup: asyncHandler(async (req: Request, res: Response) => {
    const parsed = signupSchema.safeParse(req.body);

    if (!parsed.success) {
      // Surface the most useful error message — especially for missing wallet
      const firstError = parsed.error.errors[0];
      const field = firstError.path.join('.');
      let message = firstError.message;

    if (field === 'phone' && firstError.code === 'invalid_type') {
        message = 'A phone number is required to create a creator account.';
      }
      throw new AppError(message, 400);
    }

    const result = await authService.signup(parsed.data);
    res.status(201).json({ success: true, ...result });
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = loginSchema.parse(req.body);
    const meta = { ua: req.headers['user-agent'], ip: req.ip };
    const { accessToken, refreshToken, user } = await authService.login(email, password, meta);
    res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
    res.json({ success: true, accessToken, user });
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken;
    if (!token) throw new AppError('No refresh token', 401);
    const meta = { ua: req.headers['user-agent'], ip: req.ip };
    const { accessToken, refreshToken, user } = await authService.refresh(token, meta);
    res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
    res.json({ success: true, accessToken, user });
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken;
    if (token) await authService.logout(token);
    res.clearCookie('refreshToken', {
      path:     '/',
      httpOnly: true,
      secure:   isProd,
      sameSite: isProd ? 'none' : 'lax',
    });
    res.json({ success: true });
  }),

  verifyEmail: asyncHandler(async (req: Request, res: Response) => {
    await authService.verifyEmail(req.params.token);
    res.json({ success: true, message: 'Email verified' });
  }),

  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await authService.forgotPassword(email);
    res.json({ success: true, message: 'If that email exists, a reset link was sent' });
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    const { token, password } = z.object({
      token:    z.string(),
      password: z.string().min(6),
    }).parse(req.body);
    await authService.resetPassword(token, password);
    res.json({ success: true, message: 'Password reset successful' });
  }),

  resendVerification: asyncHandler(async (req: Request, res: Response) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await authService.resendVerification(email);
    res.json({ success: true, message: 'If that email is pending verification, a new link was sent.' });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where:  { id: req.user!.id },
      select: {
        id:             true,
        name:           true,
        email:          true,
        role:           true,
        status:         true,
        country:        true,
        avatarUrl:      true,
        bio:            true,
        isEarlyAdopter: true,
        emailVerified:  true,
        createdAt:      true,
        updatedAt:      true,
      },
    });
    if (!user) throw new AppError('User not found', 404);
    res.json({ success: true, user });
  }),
};