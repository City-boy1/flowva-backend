import type { Request, Response } from 'express';
import argon2 from 'argon2';
import { User } from '../db/mongoose.js';
import prisma from '../db/prisma.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/token.js';
import logger from '../utils/logger.js';

const COOKIE_OPTS = {
  httpOnly:  true,
  secure:    process.env.NODE_ENV === 'production',
  sameSite:  (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge:    7 * 24 * 60 * 60 * 1000, // 7 days
};

// ── REGISTER ──────────────────────────────────────────
export async function register(req: Request, res: Response): Promise<void> {
  const { name, email, password, role } = req.body as {
    name: string; email: string; password: string; role: 'buyer' | 'creator';
  };

  const existing = await User.findOne({ email });
  if (existing) {
    res.status(409).json({ success: false, message: 'Email already registered' });
    return;
  }

  // argon2id — resistant to GPU and side-channel attacks
  const hashedPassword = await argon2.hash(password, {
    type:        argon2.argon2id,
    memoryCost:  65536,
    timeCost:    3,
    parallelism: 1,
  });

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    role,
  });

  // Mirror in Postgres for relational joins (orders, payouts)
  await prisma.user.create({
    data: {
      mongoId: user._id.toString(),
      email:   user.email,
      role:    role.toUpperCase() as 'BUYER' | 'CREATOR',
    },
  });

  const accessToken  = generateAccessToken({ id: user._id.toString(), email, role });
  const refreshToken = generateRefreshToken({ id: user._id.toString() });

  // Store hashed refresh token in DB
  user.refreshToken = refreshToken;
  await user.save();

  res.cookie('refreshToken', refreshToken, COOKIE_OPTS);

  logger.info(`New user registered: ${email} (${role})`);

  res.status(201).json({
    success: true,
    message: 'Account created successfully',
    accessToken,
    user: {
      id:    user._id,
      name:  user.name,
      email: user.email,
      role:  user.role,
    },
  });
}

// ── LOGIN ─────────────────────────────────────────────
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email: string; password: string };

  const user = await User.findOne({ email }).select('+password +refreshToken');
  if (!user) {
    // Constant-time response to prevent user enumeration
    await argon2.hash('dummy_prevent_timing_attack');
    res.status(401).json({ success: false, message: 'Invalid email or password' });
    return;
  }

  const valid = await argon2.verify(user.password, password);
  if (!valid) {
    res.status(401).json({ success: false, message: 'Invalid email or password' });
    return;
  }

  const accessToken  = generateAccessToken({ id: user._id.toString(), email, role: user.role });
  const refreshToken = generateRefreshToken({ id: user._id.toString() });

  user.refreshToken = refreshToken;
  await user.save();

  res.cookie('refreshToken', refreshToken, COOKIE_OPTS);

  res.json({
    success: true,
    message: 'Login successful',
    accessToken,
    user: {
      id:    user._id,
      name:  user.name,
      email: user.email,
      role:  user.role,
    },
  });
}

// ── REFRESH TOKEN ─────────────────────────────────────
export async function refreshToken(req: Request, res: Response): Promise<void> {
  const token = req.cookies.refreshToken as string | undefined;

  if (!token) {
    res.status(401).json({ success: false, message: 'No refresh token' });
    return;
  }

  let decoded: { id: string };
  try {
    decoded = verifyRefreshToken(token) as { id: string };
  } catch {
    res.status(403).json({ success: false, message: 'Invalid refresh token' });
    return;
  }

  const user = await User.findById(decoded.id).select('+refreshToken');
  if (!user || user.refreshToken !== token) {
    // Token reuse detected — clear everything
    if (user) { user.refreshToken = undefined; await user.save(); }
    res.clearCookie('refreshToken');
    res.status(403).json({ success: false, message: 'Refresh token reuse detected' });
    return;
  }

  // Rotate the refresh token on every use
  const newAccessToken  = generateAccessToken({ id: user._id.toString(), email: user.email, role: user.role });
  const newRefreshToken = generateRefreshToken({ id: user._id.toString() });

  user.refreshToken = newRefreshToken;
  await user.save();

  res.cookie('refreshToken', newRefreshToken, COOKIE_OPTS);
  res.json({ success: true, accessToken: newAccessToken });
}

// ── LOGOUT ────────────────────────────────────────────
export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies.refreshToken as string | undefined;

  if (token) {
    try {
      const decoded = verifyRefreshToken(token) as { id: string };
      const user = await User.findById(decoded.id);
      if (user) { user.refreshToken = undefined; await user.save(); }
    } catch { /* token was already invalid — still clear it */ }
  }

  res.clearCookie('refreshToken', { ...COOKIE_OPTS, maxAge: 0 });
  res.json({ success: true, message: 'Logged out' });
}

// ── GET ME ────────────────────────────────────────────
export async function getMe(req: Request & { user?: { id: string } }, res: Response): Promise<void> {
  const user = await User.findById(req.user?.id);
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }
  res.json({ success: true, user });
}