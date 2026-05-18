import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../types/index.js';
import { verifyAccessToken } from '../utils/token.js';
import { User } from '../db/mongoose.js';
import logger from '../utils/logger.js';

// ── Require valid JWT access token ────────────────────
export async function protect(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'No token provided' });
      return;
    }

    const token = header.split(' ')[1];
    const decoded = verifyAccessToken(token);

    // Fetch fresh user so we always have current role/stripeAccountId
    const user = await User.findById(decoded.id).select('-password -refreshToken');

    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }

    req.user = {
      id:             user._id.toString(),
      email:          user.email,
      role:           user.role.toUpperCase() as 'BUYER' | 'CREATOR' | 'ADMIN',
      name:           user.name,
      stripeAccountId: user.stripeAccountId,
    };

    next();
  } catch (err) {
    logger.debug('Auth middleware: invalid token');
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// ── Require creator role ──────────────────────────────
export function requireCreator(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  if (req.user.role !== 'CREATOR' && req.user.role !== 'ADMIN') {
    res.status(403).json({ success: false, message: 'Creator account required' });
    return;
  }

  next();
}

// ── Require admin role ───────────────────────────────
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ success: false, message: 'Admin access required' });
    return;
  }
  next();
}