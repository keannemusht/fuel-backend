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

  static async transferStock(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const {
        sourceTankId,
        targetTankId,
        volumeLiters,
        flowAwal,
        flowAkhir,
        driverName,
        notes,
        dateStr: reqDateStr,
        jamStr: reqJamStr,
      } = req.body;

      if (sourceTankId === targetTankId) {
        throw new AppError('Tangki sumber dan tangki tujuan tidak boleh sama.', 422);
      }

      if (!volumeLiters || volumeLiters <= 0) {
        throw new AppError('Volume transfer harus lebih dari 0 liter.', 422);
      }

      const now = new Date();
      let todayStr: string;
      let witaTimeStr: string;
      try {
        todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(now);
        witaTimeStr = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Makassar',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(now);
      } catch {
        todayStr = now.toISOString().split('T')[0];
        witaTimeStr = now.toTimeString().split(' ')[0].slice(0, 5);
      }

      const dateStr = reqDateStr || todayStr;
      const jamStr = (reqJamStr || witaTimeStr).replace(/\./g, ':');

      const result = await prisma.$transaction(async (tx) => {
        const sourceTank = await tx.storageTank.findUnique({ where: { id: sourceTankId } });
        if (!sourceTank) throw new AppError('Tangki sumber tidak ditemukan.', 404);

        const targetTank = await tx.storageTank.findUnique({ where: { id: targetTankId } });
        if (!targetTank) throw new AppError('Tangki tujuan tidak ditemukan.', 404);

        if (sourceTank.currentStockLiters < volumeLiters) {
          throw new AppError(
            `Stok di ${sourceTank.name} tidak mencukupi (Tersedia: ${sourceTank.currentStockLiters.toLocaleString()} L, Diminta: ${volumeLiters.toLocaleString()} L).`,
            422
          );
        }

        const newTargetStock = targetTank.currentStockLiters + volumeLiters;
        if (newTargetStock > targetTank.capacityLiters) {
          throw new AppError(
            `Transfer melebihi kapasitas maksimum ${targetTank.name} (${targetTank.capacityLiters.toLocaleString()} L). Sisa ruang tangki: ${(targetTank.capacityLiters - targetTank.currentStockLiters).toLocaleString()} L.`,
            422
          );
        }

        const newSourceStock = parseFloat((sourceTank.currentStockLiters - volumeLiters).toFixed(2));
        const updatedTargetStock = parseFloat(newTargetStock.toFixed(2));

        // Update tank balances
        await tx.storageTank.update({
          where: { id: sourceTankId },
          data: { currentStockLiters: newSourceStock },
        });

        await tx.storageTank.update({
          where: { id: targetTankId },
          data: { currentStockLiters: updatedTargetStock },
        });

        // Generate Transfer Number TR-YYYY-MM-DD-0001
        const datePrefix = `TR-${dateStr}-`;
        const count = await tx.stockTransfer.count({
          where: { transferNumber: { startsWith: datePrefix } },
        });
        const transferNumber = `${datePrefix}${String(count + 1).padStart(4, '0')}`;

        const transfer = await tx.stockTransfer.create({
          data: {
            transferNumber,
            sourceTankId,
            targetTankId,
            sourceTankName: sourceTank.name,
            targetTankName: targetTank.name,
            volumeLiters,
            flowAwal: flowAwal ?? null,
            flowAkhir: flowAkhir ?? null,
            dateStr,
            jamStr,
            fuelmanId: req.user?.id || 'system',
            fuelmanName: req.user?.fullName || 'Petugas',
            driverName: driverName || null,
            notes: notes || null,
            status: 'COMPLETED',
          },
        });

        // Also create a FuelLog record so it syncs to Google Sheets as "Transfer Stock"
        let transferUnit = await tx.unit.findUnique({ where: { unitCode: 'TRANSFER_STOCK' } });
        if (!transferUnit) {
          transferUnit = await tx.unit.create({
            data: {
              unitCode: 'TRANSFER_STOCK',
              category: 'FUEL_IN',
              type: 'STORAGE_TANK',
              makeModel: 'Stock Transfer Inter-Tank',
              hasHm: false,
              hasKm: false,
              hasKwh: false,
            },
          });
        }

        const { docketId, seq } = await (await import('../services/fuel.service.js')).FuelService.generateDocketId(tx, true, dateStr);

        const fuelLog = await tx.fuelLog.create({
          data: {
            logNumber: docketId,
            no: seq,
            unitId: transferUnit.id,
            fuelmanId: req.user?.id || 'system',
            tankId: targetTank.id,
            unitCode: 'Transfer Stock',
            category: 'Fuel In',
            type: 'STORAGE_TANK',
            dateStr,
            jamStr,
            previousKm: 0,
            currentKm: 0,
            deltaKm: 0,
            previousHm: 0,
            currentHm: 0,
            deltaHm: 0,
            volumeLiters: 0,
            shift: 'SHIFT 1',
            operator: driverName ? `Transfer: ${driverName}` : `Transfer ${sourceTank.name} -> ${targetTank.name}`,
            fuelInLiters: volumeLiters,
            totalFuelOut: 0,
            stockAkhir: updatedTargetStock,
            totalFuelIn: volumeLiters,
            fuelmanName: req.user?.fullName || 'Petugas',
            sourceType: 'FUEL_TRUCK',
            flowAwal: flowAwal ?? null,
            flowAkhir: flowAkhir ?? null,
            totalisatorQty: flowAkhir && flowAwal ? flowAkhir - flowAwal : volumeLiters,
            dispensedAt: now,
          },
        });

        return { transfer, fuelLog, sourceTank: { ...sourceTank, currentStockLiters: newSourceStock }, targetTank: { ...targetTank, currentStockLiters: updatedTargetStock } };
      });

      return sendSuccess(res, result, `Transfer ${volumeLiters} L dari ${result.transfer.sourceTankName} ke ${result.transfer.targetTankName} berhasil.`);
    } catch (error) {
      next(error);
    }
  }

  static async getTransfers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const skip = (page - 1) * limit;

      const [transfers, total] = await Promise.all([
        prisma.stockTransfer.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.stockTransfer.count(),
      ]);

      return sendSuccess(res, { transfers, total, page, totalPages: Math.ceil(total / limit) }, 'Stock transfers retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}

