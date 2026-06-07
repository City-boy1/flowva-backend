import { Queue, Worker } from 'bullmq';
import { getIORedis } from '../db/ioredis.js';
import logger from '../utils/logger.js';

const connection = getIORedis();

const QUEUE_OPTS = {
  connection,
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: 'exponential' as const, delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail:     200,
  },
};

export const payoutQueue = new Queue('payout', QUEUE_OPTS);

let _worker: Worker | null = null;

export function startPayoutWorker() {
  if (_worker) return _worker; // prevent double-start on hot reload

  _worker = new Worker(
    'payout',
    async (job) => {
      // ── All on-chain splits are handled by Helio at checkout time. ──────────
      // Creator's 70% goes directly to their PayoutSetting.solanaAddress.
      // Platform's 30% goes directly to PLATFORM_WALLET_ADDRESS (Phantom).
      // No withdrawal jobs are needed — creators withdraw to local currency
      // themselves via their exchange app (Binance, Monica, Coinbase, etc).
      //
      // This worker is kept for future async jobs (e.g. post-sale email
      // notifications, webhook retries, commission record syncing).

      if (job.name === 'post-sale-email') {
        const { emailService } = await import('../services/email.service.js');
        await emailService.saleMade(
          job.data.creatorEmail,
          job.data.creatorName,
          job.data.templateTitle,
          job.data.grossAmount,
          job.data.creatorEarning,
          job.data.currency,
        );
        logger.info('Post-sale email job done', { userId: job.data.creatorId });
      }
    },
    {
      connection,
      concurrency:     1,
      stalledInterval: 60_000,
      maxStalledCount: 2,
      lockDuration:    60_000,
      drainDelay:      30,
    },
  );

  _worker.on('failed', (job: any, err: Error) => {
    logger.error('Payout job failed', {
      jobId:   job?.id,
      name:    job?.name,
      attempt: job?.attemptsMade,
      error:   err.message,
    });
  });

  _worker.on('error', (err: Error) => {
    logger.error('Payout worker error', { error: err.message });
  });

  _worker.on('stalled', (jobId: string) => {
    logger.warn('Payout job stalled', { jobId });
  });

  return _worker;
}