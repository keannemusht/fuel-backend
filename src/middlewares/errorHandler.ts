import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { sendError } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (err instanceof AppError && (err.statusCode === 401 || err.statusCode === 403)) {
    logger.warn(`Auth [${err.statusCode}] on ${req.method} ${req.url}: ${err.message}`);
    sendError(res, err.message, err.statusCode, err.details);
    return;
  }

  if (err instanceof AppError) {
    logger.warn(`Operational [${err.statusCode}] on ${req.method} ${req.url}: ${err.message}`);
    sendError(res, err.message, err.statusCode, err.details);
    return;
  }

  logger.error(`Unhandled error processing ${req.method} ${req.url}:`, err);

  // Handle Prisma Known Request Errors
  if (err.code === 'P2002') {
    const target = (err.meta?.target as string[])?.join(', ') || 'field';
    sendError(res, `Duplicate field value: ${target}. Must be unique.`, 409, err.meta);
    return;
  }

  if (err.code === 'P2025') {
    sendError(res, 'Record not found.', 404);
    return;
  }

  // Handle standard JSON parser errors
  if (err.type === 'entity.parse.failed') {
    sendError(res, 'Malformed JSON payload.', 400);
    return;
  }

  // Default unhandled 500 error
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error.' : (err.message || 'Internal server error.');
  sendError(res, message, statusCode, process.env.NODE_ENV === 'development' ? err.stack : undefined);
};
