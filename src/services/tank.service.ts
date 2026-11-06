import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from './audit.service.js';
import { FuelService } from './fuel.service.js';
import { GoogleSheetsService } from './googleSheets.service.js';
import { AuditAction, SyncStatus } from '@prisma/client';
import { AuthenticatedUser, SpreadsheetRowData } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface CreateTankDto {
  tankCode: string;
  name: string;
  capacityLiters: number;
  currentStockLiters?: number;
  minStockAlertLiters?: number;
  fuelType?: string;
  tankType?: string;
  site?: string;
  slocCode?: string;
  projectArea?: string;
}

export interface UpdateTankDto {
  tankCode?: string;
  name?: string;
  capacityLiters?: number;
  currentStockLiters?: number;
  minStockAlertLiters?: number;
  fuelType?: string;
  tankType?: string;
  site?: string;
  slocCode?: string;
  projectArea?: string;
}

export interface TransferStockDto {
  sourceTankId: string;
  targetTankId: string;
  volumeLiters: number;
  flowAwal?: number;
  flowAkhir?: number;
  driverName?: string;
  notes?: string;
  dateStr?: string;
  jamStr?: string;
}

export class TankService {
  static async getTanks() {
    return prisma.storageTank.findMany({
      orderBy: { tankCode: 'asc' },
    });
  }

  static async refillTank(
    id: string,
    refilledLiters: number,
    notes?: string,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
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

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.UPDATE,
      entity: 'StorageTank',
      entityId: tank.id,
      oldValues: { currentStockLiters: tank.currentStockLiters },
      newValues: { currentStockLiters: newStock, refilledLiters, notes },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return updated;
  }

  static async createTank(
    dto: CreateTankDto,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
    const existing = await prisma.storageTank.findUnique({
      where: { tankCode: dto.tankCode.trim().toUpperCase() },
    });

    if (existing) {
      throw new AppError(`Storage Tank with code "${dto.tankCode}" already exists.`, 409);
    }

    const capacity = Number(dto.capacityLiters);
    const currentStock = Number(dto.currentStockLiters || 0);

    if (currentStock > capacity) {
      throw new AppError(`Current stock (${currentStock} L) cannot exceed maximum capacity (${capacity} L).`, 422);
    }

    const tank = await prisma.storageTank.create({
      data: {
        tankCode: dto.tankCode.trim().toUpperCase(),
        name: dto.name.trim(),
        capacityLiters: capacity,
        currentStockLiters: currentStock,
        minStockAlertLiters: Number(dto.minStockAlertLiters || 5000),
        fuelType: dto.fuelType || 'HIGH SPEED DIESEL / SOLAR B35',
        tankType: dto.tankType || 'STATIONARY',
        site: dto.site ? dto.site.trim().toUpperCase() : 'SENYIUR',
        slocCode: dto.slocCode ? dto.slocCode.trim().toUpperCase() : (dto.site === 'MUARA_PAHU' ? 'MTK003' : 'MTK001'),
        projectArea: dto.projectArea ? dto.projectArea.trim().toUpperCase() : (dto.site === 'MUARA_PAHU' ? 'MPH' : 'SNY'),
      },
    });

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.CREATE,
      entity: 'StorageTank',
      entityId: tank.id,
      newValues: tank,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return tank;
  }

  static async updateTank(
    id: string,
    dto: UpdateTankDto,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
    const oldTank = await prisma.storageTank.findUnique({ where: { id } });
    if (!oldTank) {
      throw new AppError('Storage Tank not found', 404);
    }

    if (dto.tankCode && dto.tankCode.trim().toUpperCase() !== oldTank.tankCode) {
      const duplicate = await prisma.storageTank.findUnique({
        where: { tankCode: dto.tankCode.trim().toUpperCase() },
      });
      if (duplicate) {
        throw new AppError(`Tank code "${dto.tankCode}" is already in use by another tank.`, 409);
      }
    }

    const targetCapacity = dto.capacityLiters !== undefined ? Number(dto.capacityLiters) : oldTank.capacityLiters;
    const targetStock = dto.currentStockLiters !== undefined ? Number(dto.currentStockLiters) : oldTank.currentStockLiters;

    if (targetStock > targetCapacity) {
      throw new AppError(`Current stock (${targetStock} L) cannot exceed maximum capacity (${targetCapacity} L).`, 422);
    }

    const updated = await prisma.storageTank.update({
      where: { id },
      data: {
        tankCode: dto.tankCode ? dto.tankCode.trim().toUpperCase() : oldTank.tankCode,
        name: dto.name !== undefined ? dto.name.trim() : oldTank.name,
        capacityLiters: targetCapacity,
        currentStockLiters: targetStock,
        minStockAlertLiters: dto.minStockAlertLiters !== undefined ? Number(dto.minStockAlertLiters) : oldTank.minStockAlertLiters,
        fuelType: dto.fuelType !== undefined ? dto.fuelType.trim() : oldTank.fuelType,
        tankType: dto.tankType !== undefined ? dto.tankType : (oldTank as any).tankType,
        site: dto.site !== undefined ? dto.site.trim().toUpperCase() : (oldTank as any).site,
        slocCode: dto.slocCode !== undefined ? dto.slocCode.trim().toUpperCase() : (oldTank as any).slocCode,
        projectArea: dto.projectArea !== undefined ? dto.projectArea.trim().toUpperCase() : (oldTank as any).projectArea,
      },
    });

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.UPDATE,
      entity: 'StorageTank',
      entityId: updated.id,
      oldValues: oldTank,
      newValues: updated,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return updated;
  }

  static async deleteTank(
    id: string,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
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

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.DELETE,
      entity: 'StorageTank',
      entityId: tank.id,
      oldValues: tank,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { id, name: tank.name };
  }

  static async transferStock(
    dto: TransferStockDto,
    currentUser?: AuthenticatedUser
  ) {
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
    } = dto;

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

      await tx.storageTank.update({
        where: { id: sourceTankId },
        data: { currentStockLiters: newSourceStock },
      });

      await tx.storageTank.update({
        where: { id: targetTankId },
        data: { currentStockLiters: updatedTargetStock },
      });

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
          fuelmanId: currentUser?.id || 'system',
          fuelmanName: currentUser?.fullName || 'Petugas',
          driverName: driverName || null,
          notes: notes || null,
          status: 'COMPLETED',
        },
      });

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

      const { docketId, seq } = await FuelService.generateDocketId(tx, true, dateStr);

      const fuelLog = await tx.fuelLog.create({
        data: {
          logNumber: docketId,
          no: seq,
          unitId: transferUnit.id,
          fuelmanId: currentUser?.id || 'system',
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
          fuelmanName: currentUser?.fullName || 'Petugas',
          site: (sourceTank as any).site || 'SENYIUR',
          slocCode: (sourceTank as any).slocCode || 'MTK001',
          sourceType: 'FUEL_TRUCK',
          flowAwal: flowAwal ?? null,
          flowAkhir: flowAkhir ?? null,
          totalisatorQty: flowAkhir && flowAwal ? flowAkhir - flowAwal : volumeLiters,
          dispensedAt: now,
        },
      });

      return {
        transfer,
        fuelLog,
        sourceTank: { ...sourceTank, currentStockLiters: newSourceStock },
        targetTank: { ...targetTank, currentStockLiters: updatedTargetStock },
      };
    });

    // Format spreadsheet data matching 16 columns for Google Sheets & Excel report
    const spreadsheetData: SpreadsheetRowData = {
      no: result.fuelLog.no,
      unitCode: result.fuelLog.unitCode,
      category: result.fuelLog.category,
      type: result.fuelLog.type || 'STORAGE_TANK',
      date: result.fuelLog.dateStr,
      jam: result.fuelLog.jamStr,
      hm: 0,
      km: 0,
      qtyOut: 0,
      shift: result.fuelLog.shift || 'SHIFT 1',
      operator: result.fuelLog.operator,
      fuelIn: result.fuelLog.fuelInLiters,
      totalFuelOut: result.fuelLog.totalFuelOut,
      stockAkhir: result.fuelLog.stockAkhir,
      totalFuelIn: result.fuelLog.totalFuelIn,
      fuelman: result.fuelLog.fuelmanName,
    };

    // Queue for sync retry
    const syncQueue = await prisma.syncQueue.create({
      data: {
        entityType: 'FuelLog',
        entityId: result.fuelLog.id,
        payload: JSON.stringify(spreadsheetData),
        status: SyncStatus.PENDING,
      },
    });

    // Realtime trigger to Google Sheets
    try {
      const syncResult = await GoogleSheetsService.appendFuelRow(spreadsheetData);
      if (syncResult.success) {
        await prisma.$transaction([
          prisma.fuelLog.update({
            where: { id: result.fuelLog.id },
            data: { syncStatus: SyncStatus.SYNCED, syncedAt: new Date(), syncError: null },
          }),
          prisma.syncQueue.update({
            where: { id: syncQueue.id },
            data: { status: SyncStatus.SYNCED, updatedAt: new Date(), lastError: null },
          }),
        ]);
        (result.fuelLog as any).syncStatus = SyncStatus.SYNCED;
        (result.fuelLog as any).syncedAt = new Date();
      } else {
        await prisma.$transaction([
          prisma.fuelLog.update({
            where: { id: result.fuelLog.id },
            data: { syncStatus: SyncStatus.FAILED, syncError: syncResult.error },
          }),
          prisma.syncQueue.update({
            where: { id: syncQueue.id },
            data: { status: SyncStatus.FAILED, lastError: syncResult.error, retryCount: 1 },
          }),
        ]);
        (result.fuelLog as any).syncStatus = SyncStatus.FAILED;
      }
    } catch (err: any) {
      logger.error('Failed to auto-sync transfer stock log to Google Sheets:', err);
    }

    return result;
  }

  static async getTransfers(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [transfers, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.stockTransfer.count(),
    ]);

    return {
      transfers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }
}

