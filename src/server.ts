import 'dotenv/config';
import * as Sentry from '@sentry/node';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import morgan from 'morgan';

import { validateEnv } from './utils/validateEnv.js';
import logger from './utils/logger.js';
import { connectPrisma, disconnectPrisma } from './db/prisma.js';
import { connectMongo, disconnectMongo } from './db/mongoose.js';
import { globalRateLimit } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import templateRoutes from './routes/template.routes.js';
import projectRoutes from './routes/project.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import payoutRoutes from './routes/payout.routes.js';
import messageRoutes from './routes/message.routes.js';
import adminRoutes from './routes/admin.routes.js';
import tutorialRoutes from './routes/tutorial.routes.js';
import jobRoutes      from './routes/job.routes.js';
import contactRouter from './routes/contact.routes.js';
import discordRoutes from './routes/discord.routes.js';
import { startPayoutWorker } from './queues/payout.queue.js';

validateEnv();

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// ─── Security ────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = [

  // development
  'http://127.0.0.1:5500',

  // optional localhost support
  'http://localhost:5500',
];

// production frontend
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(
    process.env.FRONTEND_URL
  );
}

app.use(cors({

  origin(origin, callback) {

    // mobile apps / postman
    if (!origin) {
      return callback(null, true);
    }

    if (
      allowedOrigins.includes(origin)
    ) {
      return callback(null, true);
    }

    return callback(
      new Error(
        `CORS blocked for origin: ${origin}`
      )
    );
  },

  credentials: true,

  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
  ],
}));
app.use(hpp());
if (process.env.NODE_ENV === 'production') {
  app.use(globalRateLimit);
}

// ─── Body / Cookies ──────────────────────────────────────────────────────────
// Raw body preserved for webhook signature verification
app.use('/api/payments/webhook/helio', express.raw({ type: '*/*' }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));


// ─── Logging ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.path === '/api/health',
  }));
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tutorials', tutorialRoutes);
app.use('/api/jobs',      jobRoutes);
app.use('/api/contact', contactRouter);
app.use('/api/discord', discordRoutes);
// Keep-alive for free tier (prevents cold starts killing long uploads)
app.get('/ping', (_req, res) => res.send('ok'));// ─── Errors ───────────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  await connectPrisma();
  await connectMongo();
  if (process.env.NODE_ENV === 'production') startPayoutWorker();
  app.listen(PORT, () => logger.info(`FLOWVA API running on port ${PORT}`));
}

async function shutdown() {
  logger.info('Shutting down…');
  await disconnectPrisma();
  await disconnectMongo();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  Sentry.captureException(reason);
});

start().catch((err) => {
  logger.error('Startup failed', { error: (err as Error).message });
  process.exit(1);
});

export default app;