// src/db/mongoose.ts
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const isProd = process.env.NODE_ENV === 'production';

// ─── Connection options ───────────────────────────────────────────────────────

const MONGO_OPTIONS: mongoose.ConnectOptions = {
  maxPoolSize: isProd ? 10 : 5,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 45_000,
  connectTimeoutMS: 10_000,
  retryWrites: true,
  retryReads: true,
};

// ─── Event listeners ──────────────────────────────────────────────────────────

mongoose.connection.on('connected', () => {
  logger.info('MongoDB connected (Atlas)');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected — attempting reconnect');
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB error', { message: err.message });
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

// Suppress Mongoose deprecation warnings in production
if (isProd) {
  mongoose.set('strictQuery', true);
}

// ─── Connect ──────────────────────────────────────────────────────────────────

export async function connectMongo(): Promise<void> {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI environment variable is not set');
  }

  try {
    await mongoose.connect(uri, MONGO_OPTIONS);
  } catch (err) {
    logger.error('MongoDB initial connection failed', { error: (err as Error).message });
    throw err;
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected cleanly');
}

export default mongoose;