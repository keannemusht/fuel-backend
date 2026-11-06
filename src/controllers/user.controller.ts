import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { UserService } from '../services/user.service.js';

export class UserController {
  static async getUsers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const users = await UserService.getUsers(req.query as any);
      return sendSuccess(res, users, 'Users retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getUserById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const user = await UserService.getUserById(id);
      return sendSuccess(res, user, 'User retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async createUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      const newUser = await UserService.createUser(req.body, req.user, {
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, newUser, 'User created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      const updatedUser = await UserService.updateUser(id, req.body, req.user, {
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, updatedUser, 'User updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      const result = await UserService.deleteUser(id, req.user, {
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, { id: result.id }, `User '${result.username}' deleted successfully`);
    } catch (error) {
      next(error);
    }
  }
}
