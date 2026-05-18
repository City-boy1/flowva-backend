import type { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';
import logger from '../utils/logger.js';

export interface AppError extends Error {
  status?:      number;
  statusCode?:  number;
  isOperational?: boolean;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.status ?? err.statusCode ?? 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Log every error internally
  logger.error(`${req.method} ${req.path} — ${err.message}`, {
    status,
    stack: err.stack,
    body:  req.body,
  });

  // Send unhandled 5xx to Sentry in production
  if (status >= 500 && isProd) {
    Sentry.captureException(err);
  }

  res.status(status).json({
    success: false,
    message: isProd && status >= 500
      ? 'An unexpected error occurred'   // Never expose stack traces in prod
      : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
}

// 404 fallthrough handler (mount after all routes)
export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
}