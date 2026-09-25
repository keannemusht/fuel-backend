import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  meta?: any;
  error?: {
    code?: string;
    details?: any;
  };
}

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message: string = 'Success',
  statusCode: number = 200,
  meta?: any
): Response => {
  const payload: ApiResponse<T> = {
    success: true,
    message,
    data,
    meta,
  };
  return res.status(statusCode).json(payload);
};

export const sendError = (
  res: Response,
  message: string = 'Internal Server Error',
  statusCode: number = 500,
  details?: any,
  code?: string
): Response => {
  const payload: ApiResponse = {
    success: false,
    message,
    error: {
      code: code || `ERR_${statusCode}`,
      details,
    },
  };
  return res.status(statusCode).json(payload);
};
