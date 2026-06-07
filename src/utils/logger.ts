// src/utils/logger.ts
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

// ─── Custom format: strip stack traces in production ─────────────────────────

const safeFormat = winston.format((info) => {
  if (isProd && info.stack) {
    delete info.stack; // never leak stack traces to logs in prod
  }
  return info;
});

// ─── Console format ───────────────────────────────────────────────────────────

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}] ${message}${extra}`;
  })
);

// ─── JSON format for production ───────────────────────────────────────────────

const jsonFormat = winston.format.combine(
  safeFormat(),
  winston.format.timestamp(),
  winston.format.errors({ stack: false }), // no stack in prod
  winston.format.json()
);

// ─── Transports ───────────────────────────────────────────────────────────────

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProd ? jsonFormat : consoleFormat,
    silent: process.env.NODE_ENV === 'test',
  }),
];

if (isProd) {
  const logsDir = path.join(__dirname, '../../logs');

  transports.push(
    new DailyRotateFile({
      dirname: logsDir,
      filename: 'flowva-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: jsonFormat,
      level: 'info',
    }),
    new DailyRotateFile({
      dirname: logsDir,
      filename: 'flowva-error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '10m',
      maxFiles: '30d',
      format: jsonFormat,
      level: 'error',
    })
  );
}

// ─── Logger instance ──────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  transports,
  exitOnError: false,
});

export default logger;