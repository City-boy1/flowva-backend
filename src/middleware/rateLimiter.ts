import rateLimit from 'express-rate-limit';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';

// ── Express rate-limit (in-memory, per instance) ──────
// Use as a first layer; Upstash handles distributed

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,
  message: { success: false, message: 'Upload rate limit exceeded, please wait' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many auth attempts, please try again later' },
});

// ── Upstash distributed rate limiting ─────────────────
// Falls back gracefully if env vars are missing (dev)
let upstashLimiter: Ratelimit | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  upstashLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '15 m'),
    analytics: true,
    prefix: 'flowva',
  });
}

export async function distributedLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!upstashLimiter) {
    next();
    return;
  }

  try {
    const identifier = req.ip ?? 'unknown';
    const { success, limit, remaining, reset } = await upstashLimiter.limit(identifier);

    res.setHeader('X-RateLimit-Limit',     limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset',     new Date(reset).toISOString());

    if (!success) {
      res.status(429).json({ success: false, message: 'Rate limit exceeded' });
      return;
    }

    next();
  } catch (err) {
    logger.warn('Upstash rate limiter error — passing through', err);
    next(); // degrade gracefully
  }
}