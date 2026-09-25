import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { AuthenticatedRequest, AuthenticatedUser } from '../types/index.js';

interface JwtPayload {
  userId: string;
  role: string;
  iat: number;
  exp: number;
}

export const authenticateJwt = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication required. Missing or malformed token.', 401);
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new AppError('Access token is missing.', 401);
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        throw new AppError('Session expired. Please refresh your token.', 401, { isExpired: true });
      }
      throw new AppError('Invalid authentication token.', 401);
    }

    // Hydrate user from DB to ensure account is active and role is valid
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new AppError('User belonging to this token no longer exists.', 401);
    }

    if (!user.isActive) {
      throw new AppError('User account has been deactivated.', 403);
    }

    req.user = user as AuthenticatedUser;
    next();
  } catch (error) {
    next(error);
  }
};
