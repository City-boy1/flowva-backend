import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Reuse in dev to avoid exhausting DB connections on hot reload
const prisma = global.__prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'warn', 'error']
    : ['warn', 'error'],
});

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export async function connectPostgres(): Promise<void> {
  await prisma.$connect();
  logger.info('PostgreSQL connected via Prisma');
}

export async function disconnectPostgres(): Promise<void> {
  await prisma.$disconnect();
  logger.info('PostgreSQL disconnected');
}

export default prisma;