import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import logger from '../utils/logger.js';

// Only initialise if Redis is configured
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;

let webhookQueue: Queue | null = null;

export function getWebhookQueue(): Queue | null {
  return webhookQueue;
}

export function initWebhookQueue(): void {
  if (!REDIS_URL) {
    logger.warn('UPSTASH_REDIS_REST_URL not set — webhook retry queue disabled');
    return;
  }

  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    tls: {},
  });

  webhookQueue = new Queue('webhook-retry', {
    connection,
    defaultJobOptions: {
      attempts:  5,
      backoff:   { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail:     500,
    },
  });

  // Worker processes failed webhook jobs
  new Worker(
    'webhook-retry',
    async (job: Job) => {
      logger.info(`Processing webhook retry job ${job.id}`, job.data);
      // Re-process the Stripe event payload here if needed
      // In production: re-fetch from Stripe API using event ID and reprocess
    },
    { connection }
  );

  logger.info('Webhook retry queue initialised');
}

export async function enqueueFailedWebhook(eventId: string, type: string): Promise<void> {
  if (!webhookQueue) return;

  await webhookQueue.add('retry', { eventId, type }, {
    jobId: `webhook_${eventId}`, // Deduplicate by Stripe event ID
  });

  logger.warn(`Queued webhook for retry: ${type} (${eventId})`);
}