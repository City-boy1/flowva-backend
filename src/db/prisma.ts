import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

const isProd = process.env.NODE_ENV === 'production';

function createPrismaClient() {
  return new PrismaClient({
    log: isProd
      ? [{ emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'query' },
        ],
    errorFormat: 'minimal',
  });
}

const prisma = globalThis.prismaGlobal ?? createPrismaClient();

if (!isProd) globalThis.prismaGlobal = prisma;

// Log queries in dev
if (!isProd) {
  (prisma as any).$on('query', (e: any) => {
    logger.debug('Prisma query', {
      query: e.query,
      duration: `${e.duration}ms`,
    });
  });
}

(prisma as any).$on('error', (e: any) => {
  logger.error('Prisma error', { message: e.message });
});

// ─── Keep-alive ping to prevent Neon cold starts ─────────────────────────────
// Pings every 4 minutes — Neon idles after 5 minutes on free tier
let _keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepAlive() {
  if (_keepAliveInterval) return;
  _keepAliveInterval = setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.debug('Prisma keep-alive ping ✓');
      // Auto-cancel stuck PENDING orders older than 2 hours
      try {
        const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const cancelled = await prisma.order.updateMany({
          where: { status: 'PENDING', createdAt: { lt: cutoff } },
          data: { status: 'CANCELLED' },
        });
        if (cancelled.count > 0) {
          logger.info(`Auto-cancelled ${cancelled.count} stuck PENDING orders`);
        }
      } catch (err) {
        logger.warn('Order cleanup failed', { error: (err as Error).message });
      }
    } catch (err) {
      logger.warn('Prisma keep-alive failed — reconnecting', {
        error: (err as Error).message,
      });
      try {
        await prisma.$connect();
      } catch (reconnErr) {
        logger.error('Prisma reconnect failed', {
          error: (reconnErr as Error).message,
        });
      }
    }
  }, 4 * 60 * 1000); // every 4 minutes
}

function stopKeepAlive() {
  if (_keepAliveInterval) {
    clearInterval(_keepAliveInterval);
    _keepAliveInterval = null;
  }
}

// ─── Connect ──────────────────────────────────────────────────────────────────

export async function connectPrisma() {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      logger.info('PostgreSQL connected via Prisma (Neon)');
      startKeepAlive();
      return;
    } catch (err) {
      lastError = err as Error;
      logger.warn(`Prisma connection attempt ${attempt}/${maxRetries} failed`, {
        error: (err as Error).message,
      });
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 3000));
      }
    }
  }

  logger.error('Prisma connection failed', { error: lastError?.message });
  throw lastError;
}
// ─── Disconnect ───────────────────────────────────────────────────────────────

export async function disconnectPrisma() {
  stopKeepAlive();
  try {
    await prisma.$disconnect();
    logger.info('PostgreSQL disconnected');
  } catch (err) {
    logger.error('Prisma disconnect failed', { error: (err as Error).message });
  }
}

export default prisma;