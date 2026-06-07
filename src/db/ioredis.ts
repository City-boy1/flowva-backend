import { Redis as IORedis } from 'ioredis';
import logger from '../utils/logger.js';

let _connection: IORedis | null = null;

export function getIORedis(): IORedis {
  if (_connection) return _connection;

_connection = new IORedis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 30000,
  commandTimeout: 60000,
  keepAlive: 30000,
  noDelay: true,
  retryStrategy: (times) => Math.min(times * 2000, 30000),
  reconnectOnError: (err: Error) => {
    return ['READONLY', 'ECONNRESET', 'ETIMEDOUT'].some((e) => err.message.includes(e));
  },
});

  _connection.on('connect', () => logger.info('BullMQ Redis connected'));
  _connection.on('error', (err: Error) => logger.error('BullMQ Redis error', { error: err.message }));
  _connection.on('reconnecting', () => logger.warn('BullMQ Redis reconnecting…'));

  return _connection;
}

export async function closeIORedis(): Promise<void> {
  if (_connection) {
    await _connection.quit();
    _connection = null;
  }
}