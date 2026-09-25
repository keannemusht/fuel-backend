import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from '../services/audit.service.js';
import { AuditAction } from '@prisma/client';

export class TankController {
  static async getTanks(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tanks = await prisma.storageTank.findMany({
        orderBy: { tankCode: 'asc' },
      });
      return sendSuccess(res, tanks, 'Storage tanks retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async refillTank(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { refilledLiters, notes } = req.body;

      if (!refilledLiters || refilledLiters <= 0) {
        throw new AppError('Refilled volume must be greater than 0 liters', 422);
      }

      const tank = await prisma.storageTank.findUnique({ where: { id } });
      if (!tank) {
        throw new AppError('Storage Tank not found', 404);
      }

      const newStock = tank.currentStockLiters + refilledLiters;
      if (newStock > tank.capacityLiters) {
        throw new AppError(
          `Refill volume exceeds maximum tank capacity of ${tank.capacityLiters.toLocaleString()} L.`,
          422
        );
      }

      const updated = await prisma.storageTank.update({
        where: { id },
        data: { currentStockLiters: newStock },
      });

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.UPDATE,
        entity: 'StorageTank',
        entityId: tank.id,
        oldValues: { currentStockLiters: tank.currentStockLiters },
        newValues: { currentStockLiters: newStock, refilledLiters, notes },
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, updated, `Successfully replenished ${refilledLiters} Liters into ${tank.name}`);
    } catch (error) {
      next(error);
    }
  }

  static async createTank(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tankCode, name, capacityLiters, currentStockLiters, minStockAlertLiters, fuelType } = req.body;

      const existing = await prisma.storageTank.findUnique({
        where: { tankCode },
      });

      if (existing) {
        throw new AppError(`Storage Tank with code "${tankCode}" already exists.`, 409);
      }

      if (currentStockLiters > capacityLiters) {
        throw new AppError(`Current stock (${currentStockLiters} L) cannot exceed maximum capacity (${capacityLiters} L).`, 422);
      }

      const tank = await prisma.storageTank.create({
        data: {
          tankCode: tankCode.trim().toUpperCase(),
          name: name.trim(),
          capacityLiters: Number(capacityLiters),
          currentStockLiters: Number(currentStockLiters || 0),
          minStockAlertLiters: Number(minStockAlertLiters || 5000),
          fuelType: fuelType || 'HIGH SPEED DIESEL / SOLAR B35',
        },
      });

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.CREATE,
        entity: 'StorageTank',
        entityId: tank.id,
        newValues: tank,
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
      const { tankCode, name, capacityLiters, currentStockLiters, minStockAlertLiters, fuelType } = req.body;

      const oldTank = await prisma.storageTank.findUnique({ where: { id } });
      if (!oldTank) {
        throw new AppError('Storage Tank not found', 404);
      }

      if (tankCode && tankCode.trim().toUpperCase() !== oldTank.tankCode) {
        const duplicate = await prisma.storageTank.findUnique({
          where: { tankCode: tankCode.trim().toUpperCase() },
        });
        if (duplicate) {
          throw new AppError(`Tank code "${tankCode}" is already in use by another tank.`, 409);
        }
      }

      const targetCapacity = capacityLiters !== undefined ? Number(capacityLiters) : oldTank.capacityLiters;
      const targetStock = currentStockLiters !== undefined ? Number(currentStockLiters) : oldTank.currentStockLiters;

      if (targetStock > targetCapacity) {
        throw new AppError(`Current stock (${targetStock} L) cannot exceed maximum capacity (${targetCapacity} L).`, 422);
      }

      const updated = await prisma.storageTank.update({
        where: { id },
        data: {
          tankCode: tankCode ? tankCode.trim().toUpperCase() : oldTank.tankCode,
          name: name !== undefined ? name.trim() : oldTank.name,
          capacityLiters: targetCapacity,
          currentStockLiters: targetStock,
          minStockAlertLiters: minStockAlertLiters !== undefined ? Number(minStockAlertLiters) : oldTank.minStockAlertLiters,
          fuelType: fuelType !== undefined ? fuelType.trim() : oldTank.fuelType,
        },
      });

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.UPDATE,
        entity: 'StorageTank',
        entityId: updated.id,
        oldValues: oldTank,
        newValues: updated,
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

      const tank = await prisma.storageTank.findUnique({
        where: { id },
        include: {
          _count: {
            select: { fuelLogs: true },
          },
        },
      });

      if (!tank) {
        throw new AppError('Storage Tank not found', 404);
      }

      if (tank._count.fuelLogs > 0) {
        throw new AppError(
          `Cannot delete "${tank.name}" because it is referenced in ${tank._count.fuelLogs} historical fuel dispense records. Modifying or deleting tanks with active fuel records violates relational audit integrity.`,
          409
        );
      }

      await prisma.storageTank.delete({ where: { id } });

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.DELETE,
        entity: 'StorageTank',
        entityId: tank.id,
        oldValues: tank,
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, { id }, `Storage tank "${tank.name}" deleted successfully`);
    } catch (error) {
      next(error);
    }
  }
}
