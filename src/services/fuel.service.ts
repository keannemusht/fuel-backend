import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from './audit.service.js';
import { GoogleSheetsService } from './googleSheets.service.js';
import { AuditAction, Role, SyncStatus, UnitCategory } from '@prisma/client';
import { AuthenticatedUser, SpreadsheetRowData } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface CreateFuelDispenseDto {
  unitId: string;
  tankId: string;
  currentKm?: number;
  currentHm?: number;
  currentKwh?: number;
  volumeLiters: number;
  shift: string;
  operator: string;
  fuelInLiters?: number;
  bypassValidation?: boolean;
  bypassReason?: string;
  dateStr?: string;
  jamStr?: string;
  sourceType?: string;
  flowAwal?: number;
  flowAkhir?: number;
  totalisatorQty?: number;
  doNumber?: string;
}

export interface CreateBackdateDispenseDto {
  unitId: string;
  tankId: string;
  currentKm?: number;
  currentHm?: number;
  currentKwh?: number;
  volumeLiters: number;
  shift: string;
  operator: string;
  dateStr: string;
  jamStr: string;
  fuelInLiters?: number;
  bypassValidation?: boolean;
  bypassReason?: string;
  fuelmanName?: string;
  sourceType?: string;
  flowAwal?: number;
  flowAkhir?: number;
  totalisatorQty?: number;
  doNumber?: string;
}

export interface CreateInboundFuelDto {
  tankId: string;
  fuelInLiters: number;
  operator: string;
  shift?: string;
  dateStr?: string;
  jamStr?: string;
  fuelmanName?: string;
  notes?: string;
}

export class FuelService {
  /**
   * Generates a standardized ISO Docket ID for fuel transactions:
   * - Dispense / Fuel Out: F-YYYY-MM-DD-0001
   * - Refill / Tank Inbound: R-YYYY-MM-DD-0001
   * The daily sequence number is auto-incremented based on existing logs on that date.
   */
  static async generateDocketId(
    tx: any,
    isRefill: boolean,
    dateStr: string
  ): Promise<{ docketId: string; seq: number }> {
    const prefix = isRefill ? 'R' : 'F';
    const datePattern = `${prefix}-${dateStr}-`; // e.g. "F-2026-09-28-"

    // Query existing logs on this date matching this prefix
    const existingLogs = await tx.fuelLog.findMany({
      where: {
        dateStr,
        logNumber: { startsWith: `${prefix}-` },
      },
      select: { logNumber: true },
    });

    let maxSeq = 0;
    for (const log of existingLogs) {
      const parts = log.logNumber.split('-');
      if (parts.length >= 5) {
        const num = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    }

    const seq = maxSeq + 1;
    const docketId = `${datePattern}${String(seq).padStart(4, '0')}`;
    return { docketId, seq };
  }

  /**
   * Performs an atomic fuel dispense transaction with strict Odometer & Hour meter delta checks.
   */
  static async recordDispense(
    dto: CreateFuelDispenseDto,
    currentUser: AuthenticatedUser,
    clientMeta?: { ipAddress?: string; userAgent?: string }
  ) {
    const {
      unitId,
      tankId,
      currentKm,
      currentHm,
      volumeLiters,
      shift,
      operator,
      fuelInLiters = 0,
      bypassValidation = false,
      bypassReason,
    } = dto;

    if (volumeLiters <= 0 && fuelInLiters <= 0) {
      throw new AppError('Dispense volume or Fuel In volume must be greater than 0', 422);
    }

    // Only ADMIN can trigger validation bypass
    if (bypassValidation && currentUser.role !== Role.ADMIN) {
      throw new AppError('Forbidden: Only System Administrators can bypass meter validation.', 403);
    }

    if (bypassValidation && (!bypassReason || bypassReason.trim().length < 5)) {
      throw new AppError('A valid reason (minimum 5 characters) is required to bypass meter validation.', 422);
    }

    // Current Date and Time in WITA (Asia/Makassar, UTC+8 - Site Operational Time)
    const now = new Date();
    let todayStr: string;
    let witaTimeStr: string;
    try {
      todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(now); // YYYY-MM-DD
      witaTimeStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Makassar',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now); // HH:mm:ss
    } catch {
      todayStr = now.toISOString().split('T')[0];
      witaTimeStr = now.toTimeString().split(' ')[0];
    }
    const dateStr = dto.dateStr || todayStr; // YYYY-MM-DD
    const jamStr = (dto.jamStr || witaTimeStr).trim().replace(/\./g, ':'); // HH:mm:ss

    // If transaction date is in the past, route through chronological backdate handler
    if (dto.dateStr && dto.dateStr < todayStr) {
      return this.recordBackdateDispense(
        {
          unitId: dto.unitId,
          tankId: dto.tankId,
          currentKm: dto.currentKm,
          currentHm: dto.currentHm,
          currentKwh: dto.currentKwh,
          volumeLiters: dto.volumeLiters,
          shift: dto.shift,
          operator: dto.operator,
          fuelInLiters: dto.fuelInLiters,
          bypassValidation: dto.bypassValidation,
          bypassReason: dto.bypassReason,
          dateStr: dto.dateStr,
          jamStr,
          sourceType: dto.sourceType,
          flowAwal: dto.flowAwal,
          flowAkhir: dto.flowAkhir,
          totalisatorQty: dto.totalisatorQty,
          doNumber: dto.doNumber,
        },
        currentUser,
        clientMeta
      );
    }

    // Execute atomic interactive transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch & lock Unit
      const unit = await tx.unit.findUnique({
        where: { id: unitId },
      });

      if (!unit) {
        throw new AppError(`Unit with ID ${unitId} not found`, 404);
      }

      if (!unit.isActive) {
        throw new AppError(`Unit ${unit.unitCode} is currently inactive or under maintenance`, 422);
      }

      // 2. Fetch Storage Tank
      const tank = await tx.storageTank.findUnique({
        where: { id: tankId },
      });

      if (!tank) {
        throw new AppError(`Storage Tank with ID ${tankId} not found`, 404);
      }

      // 3. Dynamic Delta Meter Calculations based on unit capability
      const previousKm = unit.lastKm;
      const previousHm = unit.lastHm;
      const previousKwh = unit.lastKwh || 0;

      const effectiveCurrentKm = unit.hasKm ? (currentKm ?? 0) : 0;
      const effectiveCurrentHm = unit.hasHm ? (currentHm ?? 0) : 0;
      const effectiveCurrentKwh = unit.hasKwh ? (dto.currentKwh ?? 0) : 0;

      const deltaKm = unit.hasKm ? parseFloat((effectiveCurrentKm - previousKm).toFixed(2)) : 0;
      const deltaHm = unit.hasHm ? parseFloat((effectiveCurrentHm - previousHm).toFixed(2)) : 0;
      const deltaKwh = unit.hasKwh ? parseFloat((effectiveCurrentKwh - previousKwh).toFixed(2)) : 0;

      // 4. Strict Validation Rules (unless bypassed)
      if (!bypassValidation) {
        // Calculate dynamic maximum allowable limits based on elapsed wall-clock hours
        let maxAllowedDeltaHm = 24;
        let maxAllowedDeltaKm = 1000;

        const previousLog = await tx.fuelLog.findFirst({
          where: { unitId },
          orderBy: [{ dateStr: 'desc' }, { jamStr: 'desc' }, { no: 'desc' }],
          select: { dateStr: true, jamStr: true, currentHm: true, currentKm: true },
        });

        if (previousLog) {
          const prevCleanJam = (previousLog.jamStr || '00:00:00').trim().replace(/\./g, ':');
          const prevDate = new Date(`${previousLog.dateStr}T${prevCleanJam}`);
          const currentDate = new Date(`${dateStr}T${jamStr}`);
          if (!isNaN(prevDate.getTime()) && !isNaN(currentDate.getTime())) {
            const diffHours = (currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60);
            if (diffHours > 24) {
              maxAllowedDeltaHm = Math.max(24, Math.ceil(diffHours) + 2);
              maxAllowedDeltaKm = Math.max(1000, Math.ceil(diffHours / 24) * 1000);
            }
          }
        }

        // Rule 1: Odometer Validation (Only for units with KM tracking)
        if (unit.hasKm) {
          if (effectiveCurrentKm < 0) {
            throw new AppError(
              `Odometer Validation Failed: Current KM (${effectiveCurrentKm}) cannot be negative.`,
              422,
              { currentKm: effectiveCurrentKm, violation: 'KM_NEGATIVE' }
            );
          }

          if (previousKm > 0 && effectiveCurrentKm < previousKm) {
            throw new AppError(
              `Odometer Validation Failed: Current KM (${effectiveCurrentKm}) cannot be less than last recorded KM (${previousKm}).`,
              422,
              { currentKm: effectiveCurrentKm, previousKm, deltaKm, violation: 'KM_DECREASING' }
            );
          }

          if (deltaKm > maxAllowedDeltaKm) {
            throw new AppError(
              `Odometer Validation Failed: Travel distance of ${deltaKm} KM exceeds maximum allowable limit of ${maxAllowedDeltaKm} KM.`,
              422,
              { currentKm: effectiveCurrentKm, previousKm, deltaKm, maxLimitKm: maxAllowedDeltaKm, violation: 'KM_DELTA_EXCEEDED' }
            );
          }
        }

        // Rule 2: Hour Meter Validation (Only for units with HM tracking)
        if (unit.hasHm) {
          if (effectiveCurrentHm < 0) {
            throw new AppError(
              `Hour Meter Validation Failed: Current HM (${effectiveCurrentHm}) cannot be negative.`,
              422,
              { currentHm: effectiveCurrentHm, violation: 'HM_NEGATIVE' }
            );
          }

          if (previousHm > 0 && effectiveCurrentHm <= previousHm) {
            throw new AppError(
              effectiveCurrentHm === previousHm
                ? `Hour Meter Validation Failed: Current HM (${effectiveCurrentHm}) cannot be equal to previous recorded HM (${previousHm}). Unit must operate before refuelling.`
                : `Hour Meter Validation Failed: Current HM (${effectiveCurrentHm}) cannot be less than previous recorded HM (${previousHm}). HM must increase on every refuelling.`,
              422,
              { currentHm: effectiveCurrentHm, previousHm, deltaHm, violation: 'HM_NOT_INCREASING' }
            );
          }

          if (deltaHm > maxAllowedDeltaHm) {
            throw new AppError(
              `Hour Meter Validation Failed: Operating duration of ${deltaHm} Hours exceeds maximum allowable limit of ${maxAllowedDeltaHm} Hours.`,
              422,
              { currentHm: effectiveCurrentHm, previousHm, deltaHm, maxLimitHm: maxAllowedDeltaHm, violation: 'HM_DELTA_EXCEEDED' }
            );
          }
        }

        // Rule 3: KWH Validation (Only for units with KWH tracking like Genset)
        if (unit.hasKwh) {
          if (effectiveCurrentKwh < 0) {
            throw new AppError(
              `KWH Validation Failed: Current KWH (${effectiveCurrentKwh}) cannot be negative.`,
              422,
              { currentKwh: effectiveCurrentKwh, violation: 'KWH_NEGATIVE' }
            );
          }

          if (previousKwh > 0 && effectiveCurrentKwh < previousKwh) {
            throw new AppError(
              `KWH Validation Failed: Current KWH (${effectiveCurrentKwh}) cannot be less than last recorded KWH (${previousKwh}).`,
              422,
              { currentKwh: effectiveCurrentKwh, previousKwh, deltaKwh, violation: 'KWH_DECREASING' }
            );
          }
        }
      }

      // 5. Stock Level Check
      if (volumeLiters > 0 && tank.currentStockLiters < volumeLiters) {
        throw new AppError(
          `Insufficient fuel in tank ${tank.name}. Available: ${tank.currentStockLiters.toLocaleString()} L, Requested: ${volumeLiters.toLocaleString()} L.`,
          422,
          { availableStock: tank.currentStockLiters, requestedVolume: volumeLiters }
        );
      }

      // 6. Calculate Running Totals
      const prevTotals = await tx.fuelLog.aggregate({
        where: { tankId: tank.id },
        _sum: {
          volumeLiters: true,
          fuelInLiters: true,
        },
      });

      const totalFuelOut = parseFloat(((prevTotals._sum.volumeLiters || 0) + volumeLiters).toFixed(2));
      const totalFuelIn = parseFloat(((prevTotals._sum.fuelInLiters || 0) + fuelInLiters).toFixed(2));
      const newStockBalance = parseFloat((tank.currentStockLiters - volumeLiters + fuelInLiters).toFixed(2));

      // 7. Generate ISO Docket ID: F-YYYY-MM-DD-0001 (or R-YYYY-MM-DD-0001 if fuelIn only)
      const isRefill = volumeLiters <= 0 && fuelInLiters > 0;
      const { docketId, seq } = await FuelService.generateDocketId(tx, isRefill, dateStr);
      const logNumber = docketId;
      const nextNo = seq;

      // 8. Create FuelLog record
      const fuelLog = await tx.fuelLog.create({
        data: {
          logNumber,
          no: nextNo,
          unitId: unit.id,
          fuelmanId: currentUser.id,
          tankId: tank.id,
          unitCode: unit.unitCode,
          category: unit.category,
          type: unit.type || (unit.unitCode.toUpperCase().startsWith('PM') ? 'DOUBLE_TRAILER' : 'DUMP_TRUCK'),
          dateStr,
          jamStr,
          previousKm: unit.hasKm ? previousKm : 0,
          currentKm: unit.hasKm ? effectiveCurrentKm : 0,
          deltaKm: unit.hasKm ? deltaKm : 0,
          previousHm: unit.hasHm ? previousHm : 0,
          currentHm: unit.hasHm ? effectiveCurrentHm : 0,
          deltaHm: unit.hasHm ? deltaHm : 0,
          previousKwh: unit.hasKwh ? previousKwh : 0,
          currentKwh: unit.hasKwh ? effectiveCurrentKwh : 0,
          deltaKwh: unit.hasKwh ? deltaKwh : 0,
          volumeLiters,
          shift,
          operator,
          fuelInLiters,
          totalFuelOut,
          stockAkhir: newStockBalance,
          totalFuelIn,
          fuelmanName: currentUser.fullName || currentUser.username,
          site: (tank as any)?.site || 'SENYIUR',
          slocCode: (tank as any)?.slocCode || 'MTK001',
          sourceType: dto.sourceType || (tank.tankType === 'MOBILE_TRUCK' ? 'FUEL_TRUCK' : 'FUEL_STATION'),
          flowAwal: dto.flowAwal ?? null,
          flowAkhir: dto.flowAkhir ?? null,
          totalisatorQty: dto.totalisatorQty ?? (dto.flowAkhir !== undefined && dto.flowAwal !== undefined ? parseFloat((dto.flowAkhir - dto.flowAwal).toFixed(2)) : null),
          doNumber: dto.doNumber ?? null,
          bypassValidation,
          bypassReason: bypassValidation ? bypassReason : null,
          syncStatus: SyncStatus.PENDING,
          dispensedAt: now,
        },
      });

      // 9. Update Unit Last Recorded KM, HM & KWH
      await tx.unit.update({
        where: { id: unit.id },
        data: {
          lastKm: unit.hasKm ? Math.max(unit.lastKm, effectiveCurrentKm) : unit.lastKm,
          lastHm: unit.hasHm ? Math.max(unit.lastHm, effectiveCurrentHm) : unit.lastHm,
          lastKwh: unit.hasKwh ? Math.max(unit.lastKwh, effectiveCurrentKwh) : unit.lastKwh,
          updatedAt: now,
        },
      });

      // 10. Update StorageTank Stock
      await tx.storageTank.update({
        where: { id: tank.id },
        data: {
          currentStockLiters: newStockBalance,
          updatedAt: now,
        },
      });

      // 11. Prepare Google Sheets 16-Column Row Payload (Format-compliant with customer spreadsheet)
      const spreadsheetData: SpreadsheetRowData = {
        no: docketId,
        unitCode: unit.unitCode,
        category: unit.category,
        type: (fuelLog as any).type || unit.type || (unit.unitCode.toUpperCase().startsWith('PM') ? 'DOUBLE_TRAILER' : 'DUMP_TRUCK'),
        date: dateStr,
        jam: jamStr,
        hm: unit.hasHm ? effectiveCurrentHm : '-',
        km: unit.hasKm ? effectiveCurrentKm : '-',
        qtyOut: volumeLiters,
        shift: shift,
        operator: unit.hasKwh && effectiveCurrentKwh > 0 ? `${operator} (${effectiveCurrentKwh} Kwh)` : operator,
        fuelIn: fuelInLiters,
        totalFuelOut: totalFuelOut,
        stockAkhir: newStockBalance,
        totalFuelIn: totalFuelIn,
        fuelman: currentUser.fullName || currentUser.username,
      };

      // 12. Queue for background sync
      const syncQueue = await tx.syncQueue.create({
        data: {
          entityType: 'FuelLog',
          entityId: fuelLog.id,
          payload: JSON.stringify(spreadsheetData),
          status: SyncStatus.PENDING,
        },
      });

      // 13. Create Audit Trail
      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: bypassValidation ? AuditAction.BYPASS_DISPENSE : AuditAction.CREATE,
          entity: 'FuelLog',
          entityId: fuelLog.id,
          oldValues: JSON.stringify({
            unitLastKm: previousKm,
            unitLastHm: previousHm,
            tankStock: tank.currentStockLiters,
          }),
          newValues: JSON.stringify({
            unitLastKm: currentKm,
            unitLastHm: currentHm,
            tankStock: newStockBalance,
            volumeDispensed: volumeLiters,
            bypassReason,
          }),
          ipAddress: clientMeta?.ipAddress,
          userAgent: clientMeta?.userAgent,
        },
      });

      return {
        fuelLog,
        spreadsheetData,
        syncQueueId: syncQueue.id,
        unit: {
          id: unit.id,
          unitCode: unit.unitCode,
          lastKm: currentKm,
          lastHm: currentHm,
        },
        tank: {
          id: tank.id,
          name: tank.name,
          currentStockLiters: newStockBalance,
        },
      };
    });

    // Trigger Google Sheets append
    try {
      const syncResult = await GoogleSheetsService.appendFuelRow(result.spreadsheetData);
      if (syncResult.success) {
        await prisma.$transaction([
          prisma.fuelLog.update({
            where: { id: result.fuelLog.id },
            data: { syncStatus: SyncStatus.SYNCED, syncedAt: new Date() },
          }),
          prisma.syncQueue.update({
            where: { id: result.syncQueueId },
            data: { status: SyncStatus.SYNCED, updatedAt: new Date() },
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
            where: { id: result.syncQueueId },
            data: { status: SyncStatus.FAILED, lastError: syncResult.error, retryCount: 1 },
          }),
        ]);
        (result.fuelLog as any).syncStatus = SyncStatus.FAILED;
        (result.fuelLog as any).syncError = syncResult.error;
      }
    } catch (err: any) {
      logger.error('Google Sheets sync dispatch error:', err);
    }

    return result;
  }

  /**
   * Records an atomic inbound fuel delivery (refill storage tank from supplier).
   * Aligned with existing dataset format: unitCode 'PENGISIAN', volumeLiters 0, fuelInLiters > 0, delta 0.
   */
  static async recordInboundFuel(
    dto: CreateInboundFuelDto,
    currentUser: AuthenticatedUser,
    clientMeta?: { ipAddress?: string; userAgent?: string }
  ) {
    const {
      tankId,
      fuelInLiters,
      operator,
      notes,
    } = dto;

    if (!fuelInLiters || fuelInLiters <= 0) {
      throw new AppError('Inbound fuel volume (fuelInLiters) must be greater than 0', 422);
    }

    if (!operator || operator.trim().length === 0) {
      throw new AppError('Supplier / Driver name (operator) is required', 422);
    }

    // Operational Time in WITA (Asia/Makassar, UTC+8 - Site Operational Time)
    const now = new Date();
    let todayStr: string;
    let witaTimeStr: string;
    try {
      todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(now); // YYYY-MM-DD
      witaTimeStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Makassar',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now); // HH:mm:ss
    } catch {
      todayStr = now.toISOString().split('T')[0];
      witaTimeStr = now.toTimeString().split(' ')[0];
    }
    const dateStr = dto.dateStr || todayStr;
    const jamStr = (dto.jamStr || witaTimeStr).trim().replace(/\./g, ':');

    // Determine shift
    let resolvedShift = dto.shift?.trim();
    if (!resolvedShift) {
      const hour = parseInt(jamStr.split(':')[0], 10);
      resolvedShift = (!isNaN(hour) && hour >= 6 && hour < 18) ? 'SHIFT 1' : 'SHIFT 2';
    }

    // Parse dispensedAt timestamp
    let dispensedAt = now;
    try {
      const parsed = new Date(`${dateStr}T${jamStr}`);
      if (!isNaN(parsed.getTime())) {
        dispensedAt = parsed;
      }
    } catch {}

    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch & lock StorageTank
      const tank = await tx.storageTank.findUnique({
        where: { id: tankId },
      });

      if (!tank) {
        throw new AppError(`Storage Tank with ID ${tankId} not found`, 404);
      }

      // 2. Fetch or create special "PENGISIAN" Unit (matches existing dataset format)
      let unit = await tx.unit.findUnique({
        where: { unitCode: 'PENGISIAN' },
      });

      if (!unit) {
        unit = await tx.unit.create({
          data: {
            unitCode: 'PENGISIAN',
            category: 'PENGISIAN',
            type: 'STORAGE_TANK',
            lastKm: 0,
            lastHm: 0,
            isActive: true,
          },
        });
      }

      // 3. Running Totals Calculation
      const prevTotals = await tx.fuelLog.aggregate({
        where: { tankId: tank.id },
        _sum: {
          volumeLiters: true,
          fuelInLiters: true,
        },
      });

      const totalFuelOut = parseFloat((prevTotals._sum.volumeLiters || 0).toFixed(2));
      const totalFuelIn = parseFloat(((prevTotals._sum.fuelInLiters || 0) + fuelInLiters).toFixed(2));
      const newStockBalance = parseFloat((tank.currentStockLiters + fuelInLiters).toFixed(2));

      // 4. Generate ISO Docket ID: R-YYYY-MM-DD-0001
      const { docketId, seq } = await FuelService.generateDocketId(tx, true, dateStr);
      const logNumber = docketId;
      const nextNo = seq;

      const fuelmanName = dto.fuelmanName || currentUser.fullName || currentUser.username;
      const bypassReason = notes && notes.trim()
        ? `Penerimaan BBM Supplier / Refill Tangki: ${notes.trim()}`
        : 'Penerimaan BBM Supplier / Refill Tangki';

      // 5. Create FuelLog record matching the 16-column format
      const fuelLog = await tx.fuelLog.create({
        data: {
          logNumber,
          no: nextNo,
          unitId: unit.id,
          fuelmanId: currentUser.id,
          tankId: tank.id,
          unitCode: 'PENGISIAN',
          category: unit.category || 'PENGISIAN',
          type: unit.type || 'STORAGE_TANK',
          dateStr,
          jamStr,
          previousKm: 0,
          currentKm: 0,
          deltaKm: 0,
          previousHm: 0,
          currentHm: 0,
          deltaHm: 0,
          volumeLiters: 0,
          shift: resolvedShift,
          operator: operator.trim(),
          fuelInLiters,
          totalFuelOut,
          stockAkhir: newStockBalance,
          totalFuelIn,
          fuelmanName,
          site: (tank as any)?.site || 'SENYIUR',
          slocCode: (tank as any)?.slocCode || 'MTK001',
          bypassValidation: true,
          bypassReason,
          syncStatus: SyncStatus.PENDING,
          dispensedAt,
        },
      });

      // 6. Update Storage Tank Stock
      await tx.storageTank.update({
        where: { id: tank.id },
        data: {
          currentStockLiters: newStockBalance,
          updatedAt: now,
        },
      });

      // 7. Prepare Google Sheets 16-Column Row Payload
      const spreadsheetData: SpreadsheetRowData = {
        no: docketId,
        unitCode: 'PENGISIAN',
        category: unit.category || 'PENGISIAN',
        type: unit.type || 'STORAGE_TANK',
        date: dateStr,
        jam: jamStr,
        hm: 0,
        km: 0,
        qtyOut: 0,
        shift: resolvedShift,
        operator: operator.trim(),
        fuelIn: fuelInLiters,
        totalFuelOut,
        stockAkhir: newStockBalance,
        totalFuelIn,
        fuelman: fuelmanName,
      };

      // 8. Queue for background sync
      const syncQueue = await tx.syncQueue.create({
        data: {
          entityType: 'FuelLog',
          entityId: fuelLog.id,
          payload: JSON.stringify(spreadsheetData),
          status: SyncStatus.PENDING,
        },
      });

      // 9. Create Audit Trail
      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: AuditAction.CREATE,
          entity: 'FuelLog',
          entityId: fuelLog.id,
          oldValues: JSON.stringify({
            tankStock: tank.currentStockLiters,
          }),
          newValues: JSON.stringify({
            tankStock: newStockBalance,
            fuelInLiters,
            operator: operator.trim(),
            notes: notes?.trim() || null,
          }),
          ipAddress: clientMeta?.ipAddress,
          userAgent: clientMeta?.userAgent,
        },
      });

      return {
        fuelLog,
        spreadsheetData,
        syncQueueId: syncQueue.id,
        tank: {
          id: tank.id,
          name: tank.name,
          currentStockLiters: newStockBalance,
        },
      };
    });

    // Trigger Google Sheets append
    try {
      const syncResult = await GoogleSheetsService.appendFuelRow(result.spreadsheetData);
      if (syncResult.success) {
        await prisma.$transaction([
          prisma.fuelLog.update({
            where: { id: result.fuelLog.id },
            data: { syncStatus: SyncStatus.SYNCED, syncedAt: new Date() },
          }),
          prisma.syncQueue.update({
            where: { id: result.syncQueueId },
            data: { status: SyncStatus.SYNCED, updatedAt: new Date() },
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
            where: { id: result.syncQueueId },
            data: { status: SyncStatus.FAILED, lastError: syncResult.error, retryCount: 1 },
          }),
        ]);
        (result.fuelLog as any).syncStatus = SyncStatus.FAILED;
        (result.fuelLog as any).syncError = syncResult.error;
      }
    } catch (err: any) {
      logger.error('Google Sheets sync dispatch error for inbound fuel:', err);
    }

    return result;
  }

  /**
   * Retrieves chronological meter context (preceding and subsequent logs)
   * for a specific equipment unit around a target backdate timestamp.
   */
  static async getMeterContext(unitId: string, dateStr: string, jamStr?: string) {
    if (!unitId) {
      throw new AppError('Unit ID is required', 400);
    }
    if (!dateStr) {
      throw new AppError('Date string (YYYY-MM-DD) is required', 400);
    }

    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        unitCode: true,
        category: true,
        lastKm: true,
        lastHm: true,
        isActive: true,
      },
    });

    if (!unit) {
      throw new AppError(`Unit with ID ${unitId} not found`, 404);
    }

    const cleanJamStr = (jamStr || '23:59:59').trim().replace(/\./g, ':');
    const jamParts = cleanJamStr.split(':');
    const timeTarget =
      jamParts.length === 2
        ? `${jamParts[0].padStart(2, '0')}:${jamParts[1].padStart(2, '0')}:00`
        : jamParts.length === 3
        ? `${jamParts[0].padStart(2, '0')}:${jamParts[1].padStart(2, '0')}:${jamParts[2].padStart(2, '0')}`
        : cleanJamStr;

    // 1. Fetch preceding log (strictly before target timestamp)
    const precedingLog = await prisma.fuelLog.findFirst({
      where: {
        unitId,
        OR: [
          { dateStr: { lt: dateStr } },
          { dateStr: dateStr, jamStr: { lt: timeTarget } },
        ],
      },
      orderBy: [{ dateStr: 'desc' }, { jamStr: 'desc' }, { no: 'desc' }],
      select: {
        id: true,
        logNumber: true,
        dateStr: true,
        jamStr: true,
        currentKm: true,
        currentHm: true,
        deltaKm: true,
        deltaHm: true,
        operator: true,
      },
    });

    // 2. Fetch subsequent log (strictly after target timestamp)
    const subsequentLog = await prisma.fuelLog.findFirst({
      where: {
        unitId,
        OR: [
          { dateStr: { gt: dateStr } },
          { dateStr: dateStr, jamStr: { gt: timeTarget } },
        ],
      },
      orderBy: [{ dateStr: 'asc' }, { jamStr: 'asc' }, { no: 'asc' }],
      select: {
        id: true,
        logNumber: true,
        dateStr: true,
        jamStr: true,
        currentKm: true,
        currentHm: true,
        deltaKm: true,
        deltaHm: true,
        operator: true,
      },
    });

    // Check for exact timestamp duplicate
    const exactLog = await prisma.fuelLog.findFirst({
      where: {
        unitId,
        dateStr,
        jamStr: timeTarget,
      },
      select: { id: true, logNumber: true, currentHm: true, currentKm: true, volumeLiters: true },
    });

    const baselineKm = precedingLog ? precedingLog.currentKm : 0;
    const baselineHm = precedingLog ? precedingLog.currentHm : 0;

    return {
      unit,
      precedingLog,
      subsequentLog,
      exactLog,
      hasExactDuplicate: Boolean(exactLog),
      baselineKm,
      baselineHm,
      maxAllowedKm: subsequentLog ? subsequentLog.currentKm : null,
      maxAllowedHm: subsequentLog ? subsequentLog.currentHm : null,
    };
  }

  /**
   * Records a backdated/missed fuel dispensing transaction with strict chronological HM & KM rules.
   */
  static async recordBackdateDispense(
    dto: CreateBackdateDispenseDto,
    currentUser: AuthenticatedUser,
    clientMeta?: { ipAddress?: string; userAgent?: string }
  ) {
    const {
      unitId,
      tankId,
      currentKm,
      currentHm,
      volumeLiters,
      shift,
      operator,
      dateStr,
      jamStr,
      fuelInLiters = 0,
      bypassValidation = false,
      bypassReason,
    } = dto;

    if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      throw new AppError('A valid date string (YYYY-MM-DD) is required for backdate entry', 422);
    }

    if (!jamStr || !jamStr.trim()) {
      throw new AppError('Time (HH:mm) is required for backdate entry', 422);
    }

    if (volumeLiters <= 0 && fuelInLiters <= 0) {
      throw new AppError('Dispense volume or Fuel In volume must be greater than 0', 422);
    }

    // ADMIN & MANAGEMENT can trigger validation bypass
    if (bypassValidation && currentUser.role !== Role.ADMIN && currentUser.role !== Role.MANAGEMENT) {
      throw new AppError('Forbidden: Only Administrators and Management can bypass meter validation.', 403);
    }

    if (bypassValidation && (!bypassReason || bypassReason.trim().length < 5)) {
      throw new AppError('A valid reason (minimum 5 characters) is required to bypass meter validation.', 422);
    }

    const cleanJamStr = jamStr.trim().replace(/\./g, ':');
    const jamParts = cleanJamStr.split(':');
    const jamNormalized =
      jamParts.length === 2
        ? `${jamParts[0].padStart(2, '0')}:${jamParts[1].padStart(2, '0')}:00`
        : cleanJamStr;

    // Parse dispensedAt timestamp
    let dispensedAtDate: Date;
    try {
      const parsed = new Date(`${dateStr}T${jamNormalized}`);
      dispensedAtDate = !isNaN(parsed.getTime()) ? parsed : new Date();
    } catch {
      dispensedAtDate = new Date();
    }

    // Execute atomic interactive transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch & lock Unit
      const unit = await tx.unit.findUnique({
        where: { id: unitId },
      });

      if (!unit) {
        throw new AppError(`Unit with ID ${unitId} not found`, 404);
      }

      if (!unit.isActive) {
        throw new AppError(`Unit ${unit.unitCode} is currently inactive or under maintenance`, 422);
      }

      // 2. Fetch Storage Tank
      const tank = await tx.storageTank.findUnique({
        where: { id: tankId },
      });

      if (!tank) {
        throw new AppError(`Storage Tank with ID ${tankId} not found`, 404);
      }

      // 3. Chronological Preceding and Subsequent Log Detection
      const precedingLog = await tx.fuelLog.findFirst({
        where: {
          unitId,
          OR: [
            { dateStr: { lt: dateStr } },
            { dateStr: dateStr, jamStr: { lt: jamNormalized } },
          ],
        },
        orderBy: [{ dateStr: 'desc' }, { jamStr: 'desc' }, { no: 'desc' }],
      });

      const subsequentLog = await tx.fuelLog.findFirst({
        where: {
          unitId,
          OR: [
            { dateStr: { gt: dateStr } },
            { dateStr: dateStr, jamStr: { gt: jamNormalized } },
          ],
        },
        orderBy: [{ dateStr: 'asc' }, { jamStr: 'asc' }, { no: 'asc' }],
      });

      // Baseline KM, HM, and KWH based on unit tracking capabilities
      const effectiveCurrentKm = unit.hasKm ? (currentKm ?? 0) : 0;
      const effectiveCurrentHm = unit.hasHm ? (currentHm ?? 0) : 0;
      const effectiveCurrentKwh = unit.hasKwh ? (dto.currentKwh ?? 0) : 0;

      const previousKm = unit.hasKm ? (precedingLog ? precedingLog.currentKm : unit.lastKm) : 0;
      const previousHm = unit.hasHm ? (precedingLog ? precedingLog.currentHm : unit.lastHm) : 0;
      const previousKwh = unit.hasKwh ? (precedingLog ? (precedingLog.currentKwh || 0) : unit.lastKwh) : 0;

      const deltaKm = unit.hasKm ? parseFloat((effectiveCurrentKm - previousKm).toFixed(2)) : 0;
      const deltaHm = unit.hasHm ? parseFloat((effectiveCurrentHm - previousHm).toFixed(2)) : 0;
      const deltaKwh = unit.hasKwh ? parseFloat((effectiveCurrentKwh - previousKwh).toFixed(2)) : 0;

      // Calculate elapsed hours between preceding log and this backdated log
      let maxAllowedDeltaHm = 24;
      let maxAllowedDeltaKm = 1000;
      if (precedingLog) {
        const prevCleanJam = (precedingLog.jamStr || '00:00:00').trim().replace(/\./g, ':');
        const prevDate = new Date(`${precedingLog.dateStr}T${prevCleanJam}`);
        const currDate = new Date(`${dateStr}T${jamNormalized}`);
        if (!isNaN(prevDate.getTime()) && !isNaN(currDate.getTime())) {
          const diffHours = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60);
          if (diffHours > 24) {
            maxAllowedDeltaHm = Math.max(24, Math.ceil(diffHours) + 2);
            maxAllowedDeltaKm = Math.max(1000, Math.ceil(diffHours / 24) * 1000);
          }
        }
      }

      // 4. Strict Validation Rules (unless bypassed)
      if (!bypassValidation) {
        // Rule 1: Odometer Validation (Only for units with KM tracking)
        if (unit.hasKm) {
          if (effectiveCurrentKm < 0) {
            throw new AppError(
              `Odometer Validation Failed: Current KM (${effectiveCurrentKm}) cannot be negative.`,
              422,
              { currentKm: effectiveCurrentKm, violation: 'KM_NEGATIVE' }
            );
          }

          if (previousKm > 0 && effectiveCurrentKm < previousKm) {
            throw new AppError(
              `Odometer Validation Failed: Current KM (${effectiveCurrentKm}) cannot be less than preceding recorded KM (${previousKm}) recorded on ${precedingLog?.dateStr} ${precedingLog?.jamStr}.`,
              422,
              { currentKm: effectiveCurrentKm, previousKm, deltaKm, violation: 'KM_DECREASING' }
            );
          }

          if (deltaKm > maxAllowedDeltaKm) {
            throw new AppError(
              `Odometer Validation Failed: Travel distance of ${deltaKm} KM exceeds maximum allowable limit of ${maxAllowedDeltaKm} KM.`,
              422,
              { currentKm: effectiveCurrentKm, previousKm, deltaKm, maxLimitKm: maxAllowedDeltaKm, violation: 'KM_DELTA_EXCEEDED' }
            );
          }

          if (subsequentLog && subsequentLog.currentKm > 0 && effectiveCurrentKm > subsequentLog.currentKm) {
            throw new AppError(
              `Odometer Validation Failed: Current KM (${effectiveCurrentKm}) exceeds subsequent log recorded KM (${subsequentLog.currentKm}) on ${subsequentLog.dateStr} ${subsequentLog.jamStr}.`,
              422,
              { currentKm: effectiveCurrentKm, nextKm: subsequentLog.currentKm, violation: 'KM_EXCEEDS_SUBSEQUENT' }
            );
          }
        }

        // Rule 2: Hour Meter Validation (Only for units with HM tracking)
        if (unit.hasHm) {
          if (effectiveCurrentHm < 0) {
            throw new AppError(
              `Hour Meter Validation Failed: Current HM (${effectiveCurrentHm}) cannot be negative.`,
              422,
              { currentHm: effectiveCurrentHm, violation: 'HM_NEGATIVE' }
            );
          }

          if (previousHm > 0 && effectiveCurrentHm <= previousHm) {
            throw new AppError(
              effectiveCurrentHm === previousHm
                ? `Hour Meter Validation Failed: Current HM (${effectiveCurrentHm}) cannot be equal to preceding recorded HM (${previousHm}) recorded on ${precedingLog?.dateStr} ${precedingLog?.jamStr}. Unit must operate before refuelling.`
                : `Hour Meter Validation Failed: Current HM (${effectiveCurrentHm}) cannot be less than preceding recorded HM (${previousHm}) recorded on ${precedingLog?.dateStr} ${precedingLog?.jamStr}. HM must increase on every refuelling.`,
              422,
              { currentHm: effectiveCurrentHm, previousHm, deltaHm, violation: 'HM_NOT_INCREASING' }
            );
          }

          if (deltaHm > maxAllowedDeltaHm) {
            throw new AppError(
              `Hour Meter Validation Failed: Operating duration of ${deltaHm} Hours exceeds maximum allowable limit of ${maxAllowedDeltaHm} Hours.`,
              422,
              { currentHm: effectiveCurrentHm, previousHm, deltaHm, maxLimitHm: maxAllowedDeltaHm, violation: 'HM_DELTA_EXCEEDED' }
            );
          }

          if (subsequentLog && subsequentLog.currentHm > 0 && effectiveCurrentHm >= subsequentLog.currentHm) {
            throw new AppError(
              `Hour Meter Validation Failed: Current HM (${effectiveCurrentHm}) cannot be greater than or equal to subsequent log recorded HM (${subsequentLog.currentHm}) on ${subsequentLog.dateStr} ${subsequentLog.jamStr}.`,
              422,
              { currentHm: effectiveCurrentHm, nextHm: subsequentLog.currentHm, violation: 'HM_EXCEEDS_SUBSEQUENT' }
            );
          }
        }

        // Rule 3: KWH Validation (Only for units with KWH tracking like Genset)
        if (unit.hasKwh) {
          if (effectiveCurrentKwh < 0) {
            throw new AppError(
              `KWH Validation Failed: Current KWH (${effectiveCurrentKwh}) cannot be negative.`,
              422,
              { currentKwh: effectiveCurrentKwh, violation: 'KWH_NEGATIVE' }
            );
          }

          if (previousKwh > 0 && effectiveCurrentKwh < previousKwh) {
            throw new AppError(
              `KWH Validation Failed: Current KWH (${effectiveCurrentKwh}) cannot be less than preceding recorded KWH (${previousKwh}).`,
              422,
              { currentKwh: effectiveCurrentKwh, previousKwh, deltaKwh, violation: 'KWH_DECREASING' }
            );
          }
        }
      }

      // 5. Stock Level Check
      if (volumeLiters > 0 && tank.currentStockLiters < volumeLiters) {
        throw new AppError(
          `Insufficient fuel in tank ${tank.name}. Available: ${tank.currentStockLiters.toLocaleString()} L, Requested: ${volumeLiters.toLocaleString()} L.`,
          422,
          { availableStock: tank.currentStockLiters, requestedVolume: volumeLiters }
        );
      }

      // 6. Calculate Running Totals
      const prevTotals = await tx.fuelLog.aggregate({
        where: { tankId: tank.id },
        _sum: {
          volumeLiters: true,
          fuelInLiters: true,
        },
      });

      const totalFuelOut = parseFloat(((prevTotals._sum.volumeLiters || 0) + volumeLiters).toFixed(2));
      const totalFuelIn = parseFloat(((prevTotals._sum.fuelInLiters || 0) + fuelInLiters).toFixed(2));
      const newStockBalance = parseFloat((tank.currentStockLiters - volumeLiters + fuelInLiters).toFixed(2));

      // 7. Generate ISO Docket ID: F-YYYY-MM-DD-0001 (or R-YYYY-MM-DD-0001 if fuelIn only)
      const isRefill = volumeLiters <= 0 && fuelInLiters > 0;
      const { docketId, seq } = await FuelService.generateDocketId(tx, isRefill, dateStr);
      const logNumber = docketId;
      const nextNo = seq;

      // 8. Create FuelLog record
      const fuelLog = await tx.fuelLog.create({
        data: {
          logNumber,
          no: nextNo,
          unitId: unit.id,
          fuelmanId: currentUser.id,
          tankId: tank.id,
          unitCode: unit.unitCode,
          category: unit.category,
          type: unit.type || (unit.unitCode.toUpperCase().startsWith('PM') ? 'DOUBLE_TRAILER' : 'DUMP_TRUCK'),
          dateStr,
          jamStr: jamNormalized,
          previousKm: unit.hasKm ? previousKm : 0,
          currentKm: unit.hasKm ? effectiveCurrentKm : 0,
          deltaKm: unit.hasKm ? deltaKm : 0,
          previousHm: unit.hasHm ? previousHm : 0,
          currentHm: unit.hasHm ? effectiveCurrentHm : 0,
          deltaHm: unit.hasHm ? deltaHm : 0,
          previousKwh: unit.hasKwh ? previousKwh : 0,
          currentKwh: unit.hasKwh ? effectiveCurrentKwh : 0,
          deltaKwh: unit.hasKwh ? deltaKwh : 0,
          volumeLiters,
          shift,
          operator,
          fuelInLiters,
          totalFuelOut,
          stockAkhir: newStockBalance,
          totalFuelIn,
          fuelmanName: dto.fuelmanName || currentUser.fullName || currentUser.username,
          site: (tank as any)?.site || 'SENYIUR',
          slocCode: (tank as any)?.slocCode || 'MTK001',
          sourceType: dto.sourceType || (tank.tankType === 'MOBILE_TRUCK' ? 'FUEL_TRUCK' : 'FUEL_STATION'),
          flowAwal: dto.flowAwal ?? null,
          flowAkhir: dto.flowAkhir ?? null,
          totalisatorQty: dto.totalisatorQty ?? (dto.flowAkhir !== undefined && dto.flowAwal !== undefined ? parseFloat((dto.flowAkhir - dto.flowAwal).toFixed(2)) : null),
          doNumber: dto.doNumber ?? null,
          bypassValidation,
          bypassReason: bypassValidation ? bypassReason : null,
          syncStatus: SyncStatus.PENDING,
          dispensedAt: dispensedAtDate,
        },
      });

      // 9. Update Unit Last Recorded KM, HM & KWH ONLY if this backdated record is the latest chronologically
      if (!subsequentLog) {
        await tx.unit.update({
          where: { id: unit.id },
          data: {
            lastKm: unit.hasKm ? Math.max(unit.lastKm, effectiveCurrentKm) : unit.lastKm,
            lastHm: unit.hasHm ? Math.max(unit.lastHm, effectiveCurrentHm) : unit.lastHm,
            lastKwh: unit.hasKwh ? Math.max(unit.lastKwh, effectiveCurrentKwh) : unit.lastKwh,
            updatedAt: new Date(),
          },
        });
      } else {
        // Re-chain immediate subsequent log so its baselines & deltas reflect this newly inserted record
        const updatedDeltaHm = unit.hasHm ? parseFloat(Math.max(0, subsequentLog.currentHm - effectiveCurrentHm).toFixed(2)) : 0;
        const updatedDeltaKm = unit.hasKm ? parseFloat(Math.max(0, subsequentLog.currentKm - effectiveCurrentKm).toFixed(2)) : 0;
        const updatedDeltaKwh = unit.hasKwh ? parseFloat(Math.max(0, (subsequentLog.currentKwh || 0) - effectiveCurrentKwh).toFixed(2)) : 0;
        await tx.fuelLog.update({
          where: { id: subsequentLog.id },
          data: {
            previousHm: unit.hasHm ? effectiveCurrentHm : 0,
            deltaHm: updatedDeltaHm,
            previousKm: unit.hasKm ? effectiveCurrentKm : 0,
            deltaKm: updatedDeltaKm,
            previousKwh: unit.hasKwh ? effectiveCurrentKwh : 0,
            deltaKwh: updatedDeltaKwh,
          },
        });
      }

      // 10. Update StorageTank Stock
      await tx.storageTank.update({
        where: { id: tank.id },
        data: {
          currentStockLiters: newStockBalance,
          updatedAt: new Date(),
        },
      });

      // 11. Prepare Google Sheets 16-Column Row Payload (Compliant with customer spreadsheet)
      const spreadsheetData: SpreadsheetRowData = {
        no: docketId,
        unitCode: unit.unitCode,
        category: unit.category,
        type: unit.type || (unit.unitCode.toUpperCase().startsWith('PM') ? 'DOUBLE_TRAILER' : 'DUMP_TRUCK'),
        date: dateStr,
        jam: jamNormalized,
        hm: unit.hasHm ? effectiveCurrentHm : '-',
        km: unit.hasKm ? effectiveCurrentKm : '-',
        qtyOut: volumeLiters,
        shift: shift,
        operator: unit.hasKwh && effectiveCurrentKwh > 0 ? `${operator} (${effectiveCurrentKwh} Kwh)` : operator,
        fuelIn: fuelInLiters,
        totalFuelOut: totalFuelOut,
        stockAkhir: newStockBalance,
        totalFuelIn: totalFuelIn,
        fuelman: dto.fuelmanName || currentUser.fullName || currentUser.username,
      };

      // 12. Queue for background sync
      const syncQueue = await tx.syncQueue.create({
        data: {
          entityType: 'FuelLog',
          entityId: fuelLog.id,
          payload: JSON.stringify(spreadsheetData),
          status: SyncStatus.PENDING,
        },
      });

      // 13. Create Audit Trail
      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: bypassValidation ? AuditAction.BYPASS_DISPENSE : AuditAction.CREATE,
          entity: 'FuelLog',
          entityId: fuelLog.id,
          oldValues: JSON.stringify({
            isBackdate: true,
            unitLastKm: previousKm,
            unitLastHm: previousHm,
            tankStock: tank.currentStockLiters,
            subsequentLog: subsequentLog ? { id: subsequentLog.id, km: subsequentLog.currentKm, hm: subsequentLog.currentHm } : null,
          }),
          newValues: JSON.stringify({
            isBackdate: true,
            unitLastKm: currentKm,
            unitLastHm: currentHm,
            tankStock: newStockBalance,
            volumeDispensed: volumeLiters,
            dateStr,
            jamStr: jamNormalized,
            bypassReason,
          }),
          ipAddress: clientMeta?.ipAddress,
          userAgent: clientMeta?.userAgent,
        },
      });

      return {
        fuelLog,
        spreadsheetData,
        syncQueueId: syncQueue.id,
        unit: {
          id: unit.id,
          unitCode: unit.unitCode,
          lastKm: !subsequentLog ? currentKm : unit.lastKm,
          lastHm: !subsequentLog ? currentHm : unit.lastHm,
        },
        tank: {
          id: tank.id,
          name: tank.name,
          currentStockLiters: newStockBalance,
        },
      };
    }, { maxWait: 10000, timeout: 25000 });

    // Trigger Google Sheets append
    try {
      const syncResult = await GoogleSheetsService.appendFuelRow(result.spreadsheetData);
      if (syncResult.success) {
        await prisma.$transaction([
          prisma.fuelLog.update({
            where: { id: result.fuelLog.id },
            data: { syncStatus: SyncStatus.SYNCED, syncedAt: new Date() },
          }),
          prisma.syncQueue.update({
            where: { id: result.syncQueueId },
            data: { status: SyncStatus.SYNCED, updatedAt: new Date() },
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
            where: { id: result.syncQueueId },
            data: { status: SyncStatus.FAILED, lastError: syncResult.error, retryCount: 1 },
          }),
        ]);
        (result.fuelLog as any).syncStatus = SyncStatus.FAILED;
        (result.fuelLog as any).syncError = syncResult.error;
      }
    } catch (err: any) {
      logger.error('Google Sheets sync dispatch error (backdate):', err);
    }

    return result;
  }

  /**
   * Retrieves list of fuel logs with filters and pagination
   */
  static async getFuelLogs(query: {
    page?: number;
    limit?: number;
    unitCode?: string;
    dateStr?: string;
    monthStr?: string;
    shift?: string;
    fuelmanId?: string;
    syncStatus?: SyncStatus;
    site?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.unitCode) where.unitCode = { contains: query.unitCode };
    if (query.dateStr) where.dateStr = query.dateStr;
    else if (query.monthStr) where.dateStr = { startsWith: query.monthStr };
    if (query.shift) where.shift = query.shift;
    if (query.fuelmanId) where.fuelmanId = query.fuelmanId;
    if (query.syncStatus) where.syncStatus = query.syncStatus;
    if (query.site && query.site !== 'ALL') where.site = query.site;

    const [total, logs] = await Promise.all([
      prisma.fuelLog.count({ where }),
      prisma.fuelLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ dateStr: 'desc' }, { jamStr: 'desc' }, { no: 'desc' }],
        include: {
          unit: true,
          tank: true,
          fuelman: {
            select: {
              id: true,
              username: true,
              fullName: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Shift Summary KPIs
   */
  static async getShiftSummary(dateStr?: string, shift?: string, site?: string) {
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    const where: any = { dateStr: targetDate };
    if (shift) where.shift = shift;
    if (site && site !== 'ALL') where.site = site;

    const tankWhere: any = {};
    if (site && site !== 'ALL') tankWhere.site = site;

    const [totals, count, activeTanks] = await Promise.all([
      prisma.fuelLog.aggregate({
        where,
        _sum: {
          volumeLiters: true,
          fuelInLiters: true,
        },
      }),
      prisma.fuelLog.count({ where }),
      prisma.storageTank.findMany({
        where: tankWhere,
        select: {
          id: true,
          tankCode: true,
          name: true,
          capacityLiters: true,
          currentStockLiters: true,
          minStockAlertLiters: true,
          site: true,
          slocCode: true,
        },
      }),
    ]);

    return {
      date: targetDate,
      shift: shift || 'ALL',
      site: site || 'ALL',
      totalDispensedLiters: totals._sum.volumeLiters || 0,
      totalFuelInLiters: totals._sum.fuelInLiters || 0,
      totalTransactions: count,
      tanks: activeTanks,
    };
  }

  /**
   * Monthly Summary KPIs & Analytics
   */
  static async getMonthlySummary(year: number, month: number, site?: string) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const where: any = {
      dateStr: { startsWith: monthStr },
    };
    if (site && site !== 'ALL') {
      where.site = site;
    }

    const [totals, count, distinctUnits, logs] = await Promise.all([
      prisma.fuelLog.aggregate({
        where,
        _sum: {
          volumeLiters: true,
          fuelInLiters: true,
        },
      }),
      prisma.fuelLog.count({ where }),
      prisma.fuelLog.findMany({
        where,
        select: { unitCode: true, category: true },
        distinct: ['unitCode'],
      }),
      prisma.fuelLog.findMany({
        where,
        select: { dateStr: true, volumeLiters: true },
        orderBy: { dateStr: 'asc' },
      }),
    ]);

    // Group daily consumption
    const dailyMap: Record<string, number> = {};
    for (const log of logs) {
      dailyMap[log.dateStr] = (dailyMap[log.dateStr] || 0) + log.volumeLiters;
    }

    const dailyBreakdown = Object.entries(dailyMap).map(([date, volume]) => ({
      date,
      volume: parseFloat(volume.toFixed(1)),
    }));

    return {
      monthStr,
      year,
      month,
      totalDispensedLiters: totals._sum.volumeLiters || 0,
      totalFuelInLiters: totals._sum.fuelInLiters || 0,
      totalTransactions: count,
      activeUnitsCount: distinctUnits.length,
      dailyBreakdown,
    };
  }

  /**
   * Creates a new historical fuel log record
   */
  static async createHistoricalLog(data: any, currentUser: AuthenticatedUser) {
    const rawUnitCode = String(data.unitCode || '').trim();
    if (!rawUnitCode) {
      throw new AppError('Unit code is required', 422);
    }

    let unit = await prisma.unit.findUnique({ where: { unitCode: rawUnitCode } });
    if (!unit) {
      unit = await prisma.unit.create({
        data: {
          unitCode: rawUnitCode,
          category: data.category || 'PRODUKSI',
          type: data.type || (rawUnitCode.toUpperCase().startsWith('PM') ? 'DOUBLE_TRAILER' : 'DUMP_TRUCK'),
          lastKm: parseFloat(data.currentKm) || 0,
          lastHm: parseFloat(data.currentHm) || 0,
        },
      });
    }

    let tankId: string = data.tankId || '';
    if (tankId) {
      const exists = await prisma.storageTank.findUnique({ where: { id: tankId } });
      if (!exists) tankId = '';
    }
    if (!tankId) {
      let defaultTank = await prisma.storageTank.findFirst();
      if (!defaultTank) {
        defaultTank = await prisma.storageTank.create({
          data: {
            tankCode: 'TANK-MAIN-01',
            name: 'Main Storage Tank 01 (Solar B35)',
            capacityLiters: 50000.0,
            currentStockLiters: 45000.0,
            minStockAlertLiters: 5000.0,
            fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
          },
        });
      }
      tankId = defaultTank.id;
    }

    let fuelmanId: string = currentUser?.id || '';
    if (fuelmanId) {
      const userExists = await prisma.user.findUnique({ where: { id: fuelmanId } });
      if (!userExists) fuelmanId = '';
    }
    if (!fuelmanId) {
      const firstUser = await prisma.user.findFirst();
      fuelmanId = firstUser ? firstUser.id : currentUser.id;
    }

    const dateStr = data.dateStr || new Date().toISOString().slice(0, 10);
    const isRefill = (parseFloat(data.volumeLiters) || 0) <= 0 && (parseFloat(data.fuelInLiters) || 0) > 0;
    const { docketId, seq } = await FuelService.generateDocketId(prisma, isRefill, dateStr);
    const logNumber = data.logNumber || docketId;
    const nextNo = parseInt(String(data.no), 10) || seq;

    const currentKm = parseFloat(data.currentKm) || 0;
    const currentHm = parseFloat(data.currentHm) || 0;
    const prevKm = Math.max(0, currentKm > 0 ? currentKm - 20 : 0);
    const prevHm = Math.max(0, currentHm > 0 ? currentHm - 1 : 0);
    const deltaKm = parseFloat(Math.max(0, currentKm - prevKm).toFixed(2));
    const deltaHm = parseFloat(Math.max(0, currentHm - prevHm).toFixed(2));

    const jamStr = data.jamStr || '12:00:00';
    const volumeLiters = parseFloat(data.volumeLiters) || 0;
    const fuelInLiters = parseFloat(data.fuelInLiters) || 0;

    // Safely parse dispensedAt date
    let dispensedAtDate: Date;
    try {
      const timeClean = jamStr.trim().replace(/\./g, ':');
      const parts = timeClean.split(':');
      const timeNormalized = parts.length === 2 ? `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00` : timeClean;
      const parsed = new Date(`${dateStr}T${timeNormalized}`);
      dispensedAtDate = !isNaN(parsed.getTime()) ? parsed : new Date();
    } catch {
      dispensedAtDate = new Date();
    }

    // Compute running totals & update tank stock
    const tank = await prisma.storageTank.findUnique({ where: { id: tankId } });
    const prevTotals = await prisma.fuelLog.aggregate({
      where: { tankId },
      _sum: {
        volumeLiters: true,
        fuelInLiters: true,
      },
    });

    const totalFuelOut = parseFloat(((prevTotals._sum.volumeLiters || 0) + volumeLiters).toFixed(2));
    const totalFuelIn = parseFloat(((prevTotals._sum.fuelInLiters || 0) + fuelInLiters).toFixed(2));
    const currentTankStock = tank?.currentStockLiters || 45000.0;
    const stockAkhir = parseFloat((currentTankStock - volumeLiters + fuelInLiters).toFixed(2));

    if (tank) {
      await prisma.storageTank.update({
        where: { id: tank.id },
        data: { currentStockLiters: stockAkhir },
      }).catch(() => {});
    }

    const log = await prisma.fuelLog.create({
      data: {
        logNumber,
        no: nextNo,
        unitId: unit.id,
        fuelmanId: fuelmanId!,
        tankId: tankId!,
        unitCode: rawUnitCode,
        category: data.category || unit.category,
        type: data.type || (unit as any).type || (rawUnitCode.toUpperCase().startsWith('PM') ? 'DOUBLE_TRAILER' : 'DUMP_TRUCK'),
        dateStr,
        jamStr,
        previousHm: prevHm,
        currentHm,
        deltaHm,
        previousKm: prevKm,
        currentKm,
        deltaKm,
        volumeLiters,
        shift: String(data.shift || '1'),
        operator: String(data.operator || '-'),
        fuelInLiters,
        totalFuelOut,
        stockAkhir,
        totalFuelIn,
        fuelmanName: data.fuelmanName || currentUser.fullName || currentUser.username,
        site: (tank as any)?.site || data.site || 'SENYIUR',
        slocCode: (tank as any)?.slocCode || data.slocCode || 'MTK001',
        bypassValidation: true,
        bypassReason: data.bypassReason || 'Manual Historical Entry by Admin',
        dispensedAt: dispensedAtDate,
        syncStatus: SyncStatus.PENDING,
      },
      include: {
        unit: true,
        tank: true,
      },
    });

    await AuditService.log({
      action: AuditAction.CREATE,
      entity: 'FuelLog',
      entityId: log.id,
      userId: currentUser.id,
      newValues: { no: log.no, unitCode: log.unitCode, volumeLiters: log.volumeLiters, dateStr: log.dateStr },
    });

    if (unit.id) {
      await FuelService.syncUnitMeters(unit.id);
    }

    // Google Sheets Auto-Sync & Dual-Tab Append
    const spreadsheetData: SpreadsheetRowData = {
      no: log.no,
      unitCode: log.unitCode,
      category: log.category,
      type: (log as any).type || (log.unitCode?.toUpperCase().startsWith('PM') ? 'DOUBLE_TRAILER' : 'DUMP_TRUCK'),
      date: dateStr,
      jam: jamStr,
      hm: currentHm,
      km: currentKm,
      qtyOut: volumeLiters,
      shift: String(data.shift || '1'),
      operator: String(data.operator || '-'),
      fuelIn: fuelInLiters,
      totalFuelOut: log.totalFuelOut,
      stockAkhir: log.stockAkhir,
      totalFuelIn: log.totalFuelIn,
      fuelman: data.fuelmanName || currentUser.fullName || currentUser.username,
    };

    const syncQueue = await prisma.syncQueue.create({
      data: {
        entityType: 'FuelLog',
        entityId: log.id,
        payload: JSON.stringify(spreadsheetData),
        status: SyncStatus.PENDING,
      },
    });

    try {
      const syncResult = await GoogleSheetsService.appendFuelRow(spreadsheetData);
      if (syncResult.success) {
        await prisma.$transaction([
          prisma.fuelLog.update({
            where: { id: log.id },
            data: { syncStatus: SyncStatus.SYNCED, syncedAt: new Date(), syncError: null },
          }),
          prisma.syncQueue.update({
            where: { id: syncQueue.id },
            data: { status: SyncStatus.SYNCED, updatedAt: new Date(), lastError: null },
          }),
        ]);
        (log as any).syncStatus = SyncStatus.SYNCED;
        (log as any).syncedAt = new Date();
      } else {
        await prisma.$transaction([
          prisma.fuelLog.update({
            where: { id: log.id },
            data: { syncStatus: SyncStatus.FAILED, syncError: syncResult.error },
          }),
          prisma.syncQueue.update({
            where: { id: syncQueue.id },
            data: { status: SyncStatus.FAILED, lastError: syncResult.error, retryCount: { increment: 1 } },
          }),
        ]);
        (log as any).syncStatus = SyncStatus.FAILED;
      }
    } catch (err: any) {
      logger.error('Failed to auto-sync historical log to Google Sheets:', err);
    }

    return log;
  }

  /**
   * Updates an existing historical fuel log record
   */
  static async updateHistoricalLog(id: string, data: any, currentUser: AuthenticatedUser) {
    const existing = await prisma.fuelLog.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Fuel log not found', 404);
    }

    const updateData: any = {};
    if (data.unitCode !== undefined) updateData.unitCode = String(data.unitCode).trim();
    if (data.category !== undefined) updateData.category = data.category;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.dateStr !== undefined) updateData.dateStr = data.dateStr;
    if (data.jamStr !== undefined) updateData.jamStr = data.jamStr;
    if (data.currentKm !== undefined) updateData.currentKm = parseFloat(data.currentKm) || 0;
    if (data.currentHm !== undefined) updateData.currentHm = parseFloat(data.currentHm) || 0;
    if (data.volumeLiters !== undefined) updateData.volumeLiters = parseFloat(data.volumeLiters) || 0;
    if (data.shift !== undefined) updateData.shift = String(data.shift);
    if (data.operator !== undefined) updateData.operator = String(data.operator);
    if (data.fuelInLiters !== undefined) updateData.fuelInLiters = parseFloat(data.fuelInLiters) || 0;
    if (data.fuelmanName !== undefined) updateData.fuelmanName = String(data.fuelmanName);
    if (data.no !== undefined) updateData.no = parseInt(String(data.no), 10) || existing.no;

    updateData.syncStatus = SyncStatus.PENDING;

    const updated = await prisma.fuelLog.update({
      where: { id },
      data: updateData,
      include: {
        unit: true,
        tank: true,
      },
    });

    await AuditService.log({
      action: AuditAction.UPDATE,
      entity: 'FuelLog',
      entityId: id,
      userId: currentUser.id,
      oldValues: { unitCode: existing.unitCode, volume: existing.volumeLiters, date: existing.dateStr },
      newValues: updateData,
    });

    if (updated.unitId) {
      await FuelService.syncUnitMeters(updated.unitId);
    }

    return updated;
  }

  /**
   * Deletes a historical fuel log record
   */
  static async deleteHistoricalLog(id: string, currentUser: AuthenticatedUser) {
    const existing = await prisma.fuelLog.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Fuel log not found', 404);
    }

    await prisma.fuelLog.delete({ where: { id } });

    await AuditService.log({
      action: AuditAction.DELETE,
      entity: 'FuelLog',
      entityId: id,
      userId: currentUser.id,
      oldValues: { no: existing.no, unitCode: existing.unitCode, dateStr: existing.dateStr, volumeLiters: existing.volumeLiters },
    });

    if (existing.unitId) {
      await FuelService.syncUnitMeters(existing.unitId);
    }

    return { success: true, message: `Fuel log #${existing.no} (${existing.unitCode}) deleted successfully` };
  }

  /**
   * Synchronizes a unit's baseline meters (lastKm, lastHm) with its chronologically latest fuel log
   */
  static async syncUnitMeters(unitId: string) {
    if (!unitId) return;
    try {
      const latest = await prisma.fuelLog.findFirst({
        where: { unitId },
        orderBy: [
          { dateStr: 'desc' },
          { jamStr: 'desc' },
          { no: 'desc' },
        ],
        select: { currentKm: true, currentHm: true },
      });
      if (latest) {
        await prisma.unit.update({
          where: { id: unitId },
          data: {
            lastKm: latest.currentKm,
            lastHm: latest.currentHm,
          },
        });
      }
    } catch (e: any) {
      logger.warn(`Could not sync baseline meters for unit ${unitId}: ${e.message}`);
    }
  }

  /**
   * Retrieves unique driver / operator names from past transactions
   */
  static async getDistinctOperators(): Promise<string[]> {
    const logs = await prisma.fuelLog.findMany({
      where: {
        operator: { not: '' },
      },
      select: { operator: true },
      distinct: ['operator'],
      orderBy: { operator: 'asc' },
      take: 200,
    });
    return logs
      .map((l) => l.operator.trim())
      .filter((op) => op.length > 0 && op !== '-');
  }

  /**
   * Synchronizes an individual fuel log record directly to Google Sheets
   */
  static async syncSingleLogToSheets(id: string) {
    const log = await prisma.fuelLog.findUnique({
      where: { id },
      include: { unit: true, tank: true },
    });

    if (!log) {
      throw new AppError('Fuel log not found', 404);
    }

    const spreadsheetData: SpreadsheetRowData = {
      no: log.no,
      unitCode: log.unitCode,
      category: log.category,
      type: log.type || (log.unitCode?.toUpperCase().startsWith('PM') ? 'DOUBLE_TRAILER' : 'DUMP_TRUCK'),
      date: log.dateStr,
      jam: log.jamStr,
      hm: log.currentHm,
      km: log.currentKm,
      qtyOut: log.volumeLiters,
      shift: log.shift,
      operator: log.operator,
      fuelIn: log.fuelInLiters,
      totalFuelOut: log.totalFuelOut,
      stockAkhir: log.stockAkhir,
      totalFuelIn: log.totalFuelIn,
      fuelman: log.fuelmanName,
    };

    const syncResult = await GoogleSheetsService.appendFuelRow(spreadsheetData);

    if (syncResult.success) {
      const updated = await prisma.fuelLog.update({
        where: { id },
        data: {
          syncStatus: SyncStatus.SYNCED,
          syncedAt: new Date(),
          syncError: null,
        },
      });

      // Update syncQueue if exists
      await prisma.syncQueue.updateMany({
        where: { entityId: id },
        data: {
          status: SyncStatus.SYNCED,
          updatedAt: new Date(),
          lastError: null,
        },
      });

      return {
        success: true,
        log: updated,
        message: `Log #${log.no} (${log.unitCode}) successfully synchronized to Google Sheets.`,
      };
    } else {
      await prisma.fuelLog.update({
        where: { id },
        data: {
          syncStatus: SyncStatus.FAILED,
          syncError: syncResult.error || 'Failed to append to Google Sheets',
        },
      });

      throw new AppError(syncResult.error || 'Failed to sync log to Google Sheets', 502);
    }
  }
}
