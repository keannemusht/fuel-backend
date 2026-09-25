import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../utils/AppError.js';

export const requireRole = (allowedRoles: Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Unauthorized. User not authenticated.', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          `Forbidden. Requires one of the following roles: [${allowedRoles.join(', ')}].`,
          403,
          { requiredRoles: allowedRoles, currentRole: req.user.role }
        )
      );
    }

    next();
  };
};
