// src/db/redis.ts
import { Redis } from '@upstash/redis';
import logger from '../utils/logger.js';

// ─── Upstash Redis (rate limiting + caching) ──────────────────────────────────
// Used by @upstash/ratelimit — HTTP-based, no persistent TCP connection needed

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;

  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN must be set');
  }

  _redis = new Redis({ url, token });
  logger.info('Upstash Redis client initialised');
  return _redis;
}

export default getRedis;