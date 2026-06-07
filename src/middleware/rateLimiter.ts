import { Ratelimit } from '@upstash/ratelimit';
import type { Request, Response, NextFunction } from 'express';
import getRedis from '../db/redis.js';
import logger from '../utils/logger.js';

function makeLimiter(requests: number, windowSeconds: number) {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(requests, `${windowSeconds} s`),
    analytics: false,
    prefix: 'flowva:rl',
  });
}

let _global: Ratelimit | null = null;
let _auth:   Ratelimit | null = null;
let _upload: Ratelimit | null = null;
let _payment: Ratelimit | null = null;

function globalLimiter()  {
  return (_global  ??= makeLimiter(
    parseInt(process.env.RATE_LIMIT_GLOBAL_MAX  || '500',  10),
    Math.floor(parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS  || '900000',  10) / 1000)
  ));
}
function authLimiter() {
  return (_auth ??= makeLimiter(
    parseInt(process.env.RATE_LIMIT_AUTH_MAX || '30', 10),
    Math.floor(parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || '900000', 10) / 1000)
  ));
}
function uploadLimiter()  {
  return (_upload  ??= makeLimiter(
    parseInt(process.env.RATE_LIMIT_UPLOAD_MAX  || '40',  10),
    Math.floor(parseInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS  || '3600000', 10) / 1000)
  ));
}
let _general: Ratelimit | null = null;

function generalLimiter() {
  return (_general ??= makeLimiter(
    parseInt(process.env.RATE_LIMIT_GENERAL_MAX || '60', 10),
    Math.floor(parseInt(process.env.RATE_LIMIT_GENERAL_WINDOW_MS || '60000', 10) / 1000)
  ));
}
function paymentLimiter() {
  return (_payment ??= makeLimiter(
    parseInt(process.env.RATE_LIMIT_PAYMENT_MAX || '50', 10),
    Math.floor(parseInt(process.env.RATE_LIMIT_PAYMENT_WINDOW_MS || '900000', 10) / 1000)
  ));
}

// Auth routes always key by IP — never by user ID.
// Keying by user ID breaks logout/delete flows because the
// user no longer exists, collapsing all anonymous requests
// into one shared bucket and triggering false 429s.
function getIp(req: Request): string {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';
  return `ip:${ip}`;
}

function getIdentifier(req: Request, forceIp = false): string {
  if (forceIp) return getIp(req);
  const user = (req as any).user as { id?: string } | undefined;
  if (user?.id) return `user:${user.id}`;
  return getIp(req);
}

function createMiddleware(getLimiter: () => Ratelimit, label: string, forceIp = false) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = getIdentifier(req, forceIp);
      const { success, limit, remaining, reset } = await getLimiter().limit(id);

      const nowMs   = Date.now();
      const resetMs = reset > 1_000_000_000_000 ? reset : reset * 1000;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));

      res.setHeader('X-RateLimit-Limit',     limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset',     Math.floor(resetMs / 1000));
      res.setHeader('Retry-After',           retryAfterSeconds);

      if (!success) {
        logger.warn('Rate limit exceeded', { id, label, path: req.path, retryAfter: retryAfterSeconds });
        res.status(429).json({
          success: false,
          message: `Too many requests. Please try again in ${retryAfterSeconds} seconds.`,
          retryAfter: retryAfterSeconds,
        });
        return;
      }

      next();
    } catch (err) {
      // Redis is down or slow — fail open so the app never crashes
      logger.error('Rate limiter error (failing open)', { error: (err as Error).message });
      next();
    }
  };
}
let _download: Ratelimit | null = null;
function downloadLimiter() {
  return (_download ??= makeLimiter(10, 900)); // 10 per 15 min
}

let _msg: Ratelimit | null = null;
function msgLimiter() {
  return (_msg ??= makeLimiter(40, 60)); // 40 requests per 60s per user
}
export const msgRateLimit = createMiddleware(msgLimiter, 'messages');

export const globalRateLimit  = createMiddleware(globalLimiter,  'global');
export const authRateLimit    = createMiddleware(authLimiter,    'auth',    true);
export const uploadRateLimit  = createMiddleware(uploadLimiter,  'upload');
export const paymentRateLimit = createMiddleware(paymentLimiter, 'payment');
export const generalRateLimit = createMiddleware(generalLimiter, 'general'); // ADD this line
export const downloadRateLimit = createMiddleware(downloadLimiter, 'download', true);
