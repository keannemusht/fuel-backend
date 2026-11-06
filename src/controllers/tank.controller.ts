import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { TankService } from '../services/tank.service.js';

export class TankController {
  static async getTanks(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tanks = await TankService.getTanks();
      return sendSuccess(res, tanks, 'Storage tanks retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async refillTank(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { refilledLiters, notes } = req.body;
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      const updated = await TankService.refillTank(
        id,
        refilledLiters,
        notes,
        req.user,
        { ipAddress: req.ip, userAgent }
      );

      return sendSuccess(res, updated, `Successfully replenished ${refilledLiters} Liters into tank`);
    } catch (error) {
      next(error);
    }
  }

  static async createTank(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      const tank = await TankService.createTank(req.body, req.user, {
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, tank, 'Storage tank registered successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateTank(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      const updated = await TankService.updateTank(id, req.body, req.user, {
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, updated, 'Storage tank updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteTank(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      const result = await TankService.deleteTank(id, req.user, {
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, { id: result.id }, `Storage tank "${result.name}" deleted successfully`);
    } catch (error) {
      next(error);
    }
  }

  static async transferStock(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await TankService.transferStock(req.body, req.user);
      return sendSuccess(
        res,
        result,
        `Transfer ${req.body.volumeLiters} L dari ${result.transfer.sourceTankName} ke ${result.transfer.targetTankName} berhasil.`
      );
    } catch (error) {
      next(error);
    }
  }

  static async getTransfers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const result = await TankService.getTransfers(page, limit);
      return sendSuccess(res, result, 'Stock transfers retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}
