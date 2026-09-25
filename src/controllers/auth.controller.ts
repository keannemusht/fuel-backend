import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { sendSuccess } from '../utils/response.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AuditService } from '../services/audit.service.js';
import { AuditAction } from '@prisma/client';

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, password } = req.body;
      const result = await AuthService.login(username, password);

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: result.user.id,
        action: AuditAction.LOGIN,
        entity: 'User',
        entityId: result.user.id,
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, result, 'Login successful');
    } catch (error) {
      next(error);
    }
  }

  static async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const result = await AuthService.refreshToken(refreshToken);
      return sendSuccess(res, result, 'Token refreshed successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, req.user, 'Current user profile retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async registerUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await AuthService.createUser(req.body);
      return sendSuccess(res, user, 'User registered successfully', 201);
    } catch (error) {
      next(error);
    }
  }
}
