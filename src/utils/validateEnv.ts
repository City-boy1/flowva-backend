import logger from './logger.js';

const REQUIRED: { key: string; description: string }[] = [
  // ── Databases ───────────────────────────────────────────────────────────────
  { key: 'DATABASE_URL',          description: 'Neon PostgreSQL connection string' },
  { key: 'DIRECT_URL',            description: 'Neon PostgreSQL direct connection string' },
  { key: 'MONGO_URI',             description: 'MongoDB Atlas connection string' },

  // ── App ─────────────────────────────────────────────────────────────────────
  { key: 'FRONTEND_URL',          description: 'Frontend origin for CORS' },
  { key: 'COOKIE_SECRET',         description: 'Cookie signing secret' },

  // ── Auth ────────────────────────────────────────────────────────────────────
  { key: 'JWT_ACCESS_SECRET',     description: 'JWT access token secret' },
  { key: 'JWT_REFRESH_SECRET',    description: 'JWT refresh token secret' },

  // ── Redis ───────────────────────────────────────────────────────────────────
  { key: 'UPSTASH_REDIS_URL',     description: 'Upstash Redis REST URL' },
  { key: 'UPSTASH_REDIS_TOKEN',   description: 'Upstash Redis REST token' },
  { key: 'REDIS_HOST',            description: 'ioredis host for BullMQ' },
  { key: 'REDIS_PASSWORD',        description: 'ioredis password for BullMQ' },

  // ── Storage ─────────────────────────────────────────────────────────────────
  { key: 'CLOUDINARY_CLOUD_NAME', description: 'Cloudinary cloud name' },
  { key: 'CLOUDINARY_API_KEY',    description: 'Cloudinary API key' },
  { key: 'CLOUDINARY_API_SECRET', description: 'Cloudinary API secret' },

  // ── Email ───────────────────────────────────────────────────────────────────
  { key: 'RESEND_API_KEY',        description: 'Resend email API key' },
  { key: 'ADMIN_EMAIL',           description: 'Platform admin email' },

  // ── Helio (buyer checkout + auto 30/70 split on-chain) ──────────────────────
  { key: 'HELIO_API_KEY',         description: 'Helio public API key' },
  { key: 'HELIO_API_SECRET',      description: 'Helio secret key' },
  { key: 'HELIO_WEBHOOK_SECRET',  description: 'Helio webhook signing secret' },

  // ── Platform wallet ─────────────────────────────────────────────────────────
  { key: 'PLATFORM_WALLET_ADDRESS', description: 'Phantom Solana wallet — receives 30% commission' },
  { key: 'USDC_MINT',             description: 'USDC SPL token mint address on Solana' },
];

const OPTIONAL: { key: string; description: string }[] = [
  { key: 'SENTRY_DSN',            description: 'Sentry DSN for error tracking' },
  { key: 'RESEND_DEV_TO',         description: 'Override email recipient in development' },
];

export function validateEnv(): void {
  const missing: string[] = [];

  for (const { key, description } of REQUIRED) {
    if (!process.env[key]?.trim()) {
      missing.push(`  ✗ ${key} — ${description}`);
    }
  }

  for (const { key, description } of OPTIONAL) {
    if (!process.env[key]?.trim()) {
      logger.warn(`Optional env not set: ${key} — ${description}`);
    }
  }

  if (process.env.NODE_ENV === 'production') {
    if ((process.env.JWT_ACCESS_SECRET?.length ?? 0) < 32) {
      missing.push('  ✗ JWT_ACCESS_SECRET must be at least 32 characters in production');
    }
    if ((process.env.JWT_REFRESH_SECRET?.length ?? 0) < 32) {
      missing.push('  ✗ JWT_REFRESH_SECRET must be at least 32 characters in production');
    }
  }

  if (missing.length > 0) {
    logger.error(`Missing required environment variables:\n${missing.join('\n')}`);
    process.exit(1);
  }

  logger.info('Environment variables validated ✓');
}