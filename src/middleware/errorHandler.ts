import type { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger.js';


export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: 'The requested resource was not found.',
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (!(err instanceof AppError) || !err.isOperational) {
    Sentry.captureException(err);
  }

  // Zod validation
  if (err instanceof ZodError) {
    logger.error('Zod validation error', { path: req.path, errors: err.errors });
    res.status(422).json({
      success: false,
      message: 'Please check your input and try again.',
      errors: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[]) ?? [];
      const field = fields[0] ?? 'field';
      res.status(409).json({
        success: false,
        message: `An account with this ${field} already exists.`,
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ success: false, message: 'Not found.' });
      return;
    }
    if (err.code === 'P2024') {
      res.status(503).json({ success: false, message: 'Service temporarily unavailable. Please try again.' });
      return;
    }
    logger.error('Prisma known error', { code: err.code });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    return;
  }

  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    logger.error('Prisma unknown error');
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    return;
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    logger.error('Prisma init error');
    res.status(503).json({ success: false, message: 'Service temporarily unavailable. Please try again.' });
    return;
  }

  // Operational AppErrors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('App error', { statusCode: err.statusCode, path: req.path });
    }
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // Unknown — never expose internals
  logger.error('Unhandled error', {
    message: err instanceof Error ? err.message : 'Unknown',
    stack:   err instanceof Error ? err.stack   : String(err),
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again.',
  });
}