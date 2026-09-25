import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from '../services/audit.service.js';
import { AuditAction, UnitCategory } from '@prisma/client';

export class UnitController {
  static async getUnits(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { search, category, isActive } = req.query;
      const where: any = {};

      if (search) {
        where.OR = [
          { unitCode: { contains: search as string } },
          { plateNumber: { contains: search as string } },
          { makeModel: { contains: search as string } },
        ];
      }

      if (category) {
        where.category = category as UnitCategory;
      }

      if (isActive !== undefined) {
        where.isActive = isActive === 'true';
      }

      const units = await prisma.unit.findMany({
        where,
        orderBy: { unitCode: 'asc' },
      });

      return sendSuccess(res, units, 'Units retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getUnitById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const unit = await prisma.unit.findUnique({
        where: { id },
      });

      if (!unit) {
        throw new AppError('Unit not found', 404);
      }

      return sendSuccess(res, unit, 'Unit retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async createUnit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { unitCode, plateNumber, category, makeModel, lastKm, lastHm } = req.body;

      const existing = await prisma.unit.findUnique({
        where: { unitCode },
      });

      if (existing) {
        throw new AppError(`Unit with code ${unitCode} already exists`, 409);
      }

      const unit = await prisma.unit.create({
        data: {
          unitCode,
          plateNumber,
          category,
          makeModel,
          lastKm: lastKm || 0,
          lastHm: lastHm || 0,
        },
      });

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.CREATE,
        entity: 'Unit',
        entityId: unit.id,
        newValues: unit,
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
      const { plateNumber, category, makeModel, lastKm, lastHm, isActive } = req.body;

      const oldUnit = await prisma.unit.findUnique({ where: { id } });
      if (!oldUnit) {
        throw new AppError('Unit not found', 404);
      }

      const updated = await prisma.unit.update({
        where: { id },
        data: {
          plateNumber,
          category,
          makeModel,
          lastKm: lastKm !== undefined ? lastKm : oldUnit.lastKm,
          lastHm: lastHm !== undefined ? lastHm : oldUnit.lastHm,
          isActive: isActive !== undefined ? isActive : oldUnit.isActive,
        },
      });

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.UPDATE,
        entity: 'Unit',
        entityId: updated.id,
        oldValues: oldUnit,
        newValues: updated,
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

      const unit = await prisma.unit.findUnique({
        where: { id },
        include: {
          _count: {
            select: { fuelLogs: true },
          },
        },
      });

      if (!unit) {
        throw new AppError('Fleet Unit not found', 404);
      }

      if (unit._count.fuelLogs > 0) {
        throw new AppError(
          `Cannot permanently delete unit "${unit.unitCode}" because it has ${unit._count.fuelLogs} associated fuel dispensing records. You can deactivate this unit instead to keep historical logs intact.`,
          409
        );
      }

      await prisma.unit.delete({ where: { id } });

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.DELETE,
        entity: 'Unit',
        entityId: unit.id,
        oldValues: unit,
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, { id }, `Unit "${unit.unitCode}" deleted successfully`);
    } catch (error) {
      next(error);
    }
  }
}
