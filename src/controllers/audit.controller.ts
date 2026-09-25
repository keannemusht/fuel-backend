import { Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { AuditAction } from '@prisma/client';

export class AuditController {
  static async getLogs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page, limit, entity, action, userId } = req.query;
      const result = await AuditService.getLogs({
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        entity: entity as string,
        action: action as AuditAction,
        userId: userId as string,
      });

      return sendSuccess(res, result.data, 'Audit logs retrieved successfully', 200, result.meta);
    } catch (error) {
      next(error);
    }
  }

  static async getLogById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const log = await AuditService.getLogById(id);
      if (!log) {
        throw new AppError('Audit log entry not found', 404);
      }
      return sendSuccess(res, log, 'Audit log retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async createLog(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { action, entity, entityId, reason, notes, details } = req.body;
      if (!action || !entity) {
        throw new AppError('Action and entity are required', 400);
      }
      const newLog = await AuditService.createManualLog({
        userId: req.user?.id,
        action: action as AuditAction,
        entity,
        entityId,
        reason: reason || notes,
        newValues: details ? (typeof details === 'object' ? details : { details }) : (reason ? { reason } : null),
        ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1',
        userAgent: req.headers['user-agent'],
      });
      return sendSuccess(res, newLog, 'Audit log created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateLog(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { reason, notes } = req.body;
      const updated = await AuditService.updateLog(id, { reason, notes });
      if (!updated) {
        throw new AppError('Audit log entry not found', 404);
      }
      return sendSuccess(res, updated, 'Audit log updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteLog(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await AuditService.deleteLog(id);
      return sendSuccess(res, null, 'Audit log entry deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async clearLogs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await AuditService.clearLogs();
      return sendSuccess(res, result, 'All audit logs cleared successfully');
    } catch (error) {
      next(error);
    }
  }
}
