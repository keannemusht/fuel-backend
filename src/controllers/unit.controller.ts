import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { UnitService } from '../services/unit.service.js';

export class UnitController {
  static async getUnits(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const units = await UnitService.getUnits(req.query as any);
      return sendSuccess(res, units, 'Units retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getUnitById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const unit = await UnitService.getUnitById(id);
      return sendSuccess(res, unit, 'Unit retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async createUnit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];
      const unit = await UnitService.createUnit(req.body, req.user, {
        ipAddress: req.ip,
        userAgent,
      });
      return sendSuccess(res, unit, 'Unit created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateUnit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];
      const updated = await UnitService.updateUnit(id, req.body, req.user, {
        ipAddress: req.ip,
        userAgent,
      });
      return sendSuccess(res, updated, 'Unit updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteUnit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];
      const result = await UnitService.deleteUnit(id, req.user, {
        ipAddress: req.ip,
        userAgent,
      });
      return sendSuccess(res, { id: result.id }, `Unit "${result.unitCode}" deleted successfully`);
    } catch (error) {
      next(error);
    }
  }
}
