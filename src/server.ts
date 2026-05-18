import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import * as Sentry from '@sentry/node';

import { connectPostgres, disconnectPostgres } from './db/prisma.js';
import { connectMongo,  disconnectMongo  } from './db/mongoose.js';
import { initWebhookQueue } from './queues/webhookQueue.js';
import { globalLimiter, distributedLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import logger from './utils/logger.js';

import authRoutes      from './routes/authRoutes.js';
import templateRoutes  from './routes/templateRoutes.js';
import paymentRoutes   from './routes/paymentRoutes.js';
import messageRoutes   from './routes/messageRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import orderRoutes     from './routes/orderRoutes.js';
import creatorRoutes   from './routes/creatorRoutes.js';
import reviewRoutes    from './routes/reviewRoutes.js';

// ── Sentry (must initialise before anything else) ─────
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn:              process.env.SENTRY_DSN,
    environment:      process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.2,
  });
  logger.info('Sentry initialised');
}

const app  = express();
const PORT = parseInt(process.env.PORT ?? '5000');
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5500';

// ══════════════════════════════════════════════════════
// SECURITY HEADERS
// ══════════════════════════════════════════════════════
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ══════════════════════════════════════════════════════
// CORS — only allow the configured frontend URL
// ══════════════════════════════════════════════════════
app.use(cors({
  origin:         FRONTEND_URL,
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ══════════════════════════════════════════════════════
// STRIPE WEBHOOK — raw body BEFORE express.json()
// This route must be registered before the body parser middleware
// ══════════════════════════════════════════════════════
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    // Dynamically import to avoid circular issues
    import('./routes/paymentRoutes.js')
      .then(m => m.default(req, res, next))
      .catch(next);
  }
);

// ══════════════════════════════════════════════════════
// BODY PARSERS (after webhook raw route)
// ══════════════════════════════════════════════════════
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(compression());

// ══════════════════════════════════════════════════════
// LOGGING
// ══════════════════════════════════════════════════════
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ══════════════════════════════════════════════════════
// RATE LIMITING
// ══════════════════════════════════════════════════════
app.use(globalLimiter);
app.use(distributedLimiter);

// ══════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ══════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════
app.use('/api/auth',       authRoutes);
app.use('/api/templates',  templateRoutes);
app.use('/api/payments',   paymentRoutes);
app.use('/api/messages',   messageRoutes);
app.use('/api/dashboard',  dashboardRoutes);
app.use('/api/orders',     orderRoutes);
app.use('/api/creators',   creatorRoutes);

// Reviews are nested under templates: /api/templates/:templateId/reviews
app.use('/api/templates/:templateId/reviews', reviewRoutes);

// ══════════════════════════════════════════════════════
// 404 + GLOBAL ERROR HANDLER (must be last)
// ══════════════════════════════════════════════════════
app.use(notFound);
app.use(errorHandler);

// ══════════════════════════════════════════════════════
// START SERVER
// ══════════════════════════════════════════════════════
async function start(): Promise<void> {
  try {
    await connectPostgres();
    await connectMongo();
    initWebhookQueue();

    const server = app.listen(PORT, () => {
      logger.info(`FLOWVA API — port ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
      logger.info(`CORS allowed origin: ${FRONTEND_URL}`);
    });

    // ── Graceful shutdown ────────────────────────────
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received — shutting down`);
      server.close(async () => {
        await disconnectPostgres();
        await disconnectMongo();
        logger.info('Connections closed — exiting');
        process.exit(0);
      });
      setTimeout(() => { process.exit(1); }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection', reason);
      Sentry.captureException(reason);
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception', err);
      Sentry.captureException(err);
      process.exit(1);
    });

  } catch (err) {
    logger.error('Server failed to start', err);
    process.exit(1);
  }
}

start();