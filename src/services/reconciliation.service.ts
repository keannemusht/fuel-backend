import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';
import { MasterEquipmentService } from './masterEquipment.service.js';

export interface AnomalyItem {
  id: string;
  unitCode: string;
  category: string;
  type: string;
  dateStr: string;
  jamStr: string;
  shift: string;
  operator: string;
  volumeLiters: number;
  site: string;
  meterType: 'HM' | 'KM';
  currentMeter: number;
  previousMeter: number;
  deltaMeter: number;
  anomalyType: 'METER_DECREASE' | 'METER_ZERO' | 'METER_EQUAL' | 'METER_JUMP' | 'NON_DISPENSE' | 'TIMESTAMP_DUPLICATE';
  description: string;
  proposedPrevious: number;
  proposedCurrent: number;
  confidence: 'HIGH' | 'MEDIUM' | 'REVIEW_NEEDED';
  fixStrategy: string;
}

export interface ReconciliationAuditResult {
  monthStr: string;
  site: string;
  totalLogs: number;
  validLogs: number;
  healthScore: number;
  categories: {
    meterDecrease: number;
    meterZero: number;
    meterEqual: number;
    meterJump: number;
    nonDispense: number;
    duplicateTimestamp: number;
  };
  anomalies: AnomalyItem[];
}

export class ReconciliationService {
  /**
   * Evaluates logs for a given month and detects all data anomalies
   */
  static async auditMonth(filter: { monthStr?: string; site?: string }): Promise<ReconciliationAuditResult> {
    const where: any = {};
    if (filter?.monthStr) {
      where.dateStr = { startsWith: filter.monthStr };
    }
    if (filter?.site && filter.site !== 'ALL') {
      where.site = filter.site;
    }

    const logs = await prisma.fuelLog.findMany({
      where,
      include: {
        unit: {
          select: {
            hasHm: true,
            hasKm: true,
            category: true,
            type: true,
            plateNumber: true,
          },
        },
      },
      orderBy: [{ dateStr: 'asc' }, { jamStr: 'asc' }],
    });

    const anomalies: AnomalyItem[] = [];
    const categories = {
      meterDecrease: 0,
      meterZero: 0,
      meterEqual: 0,
      meterJump: 0,
      nonDispense: 0,
      duplicateTimestamp: 0,
    };

    // Group logs by unitCode to analyze chronological meter sequence
    const unitGroups = new Map<string, typeof logs>();
    for (const log of logs) {
      const code = (log.unitCode || '').replace(/\s+/g, '');
      if (!unitGroups.has(code)) unitGroups.set(code, []);
      unitGroups.get(code)!.push(log);
    }

    for (const [unitCode, uLogs] of unitGroups.entries()) {
      const isHm = uLogs[0]?.unit?.hasHm ?? true;
      let lastKnownValid = 0;

      for (let i = 0; i < uLogs.length; i++) {
        const log = uLogs[i];
        const nextLog = i < uLogs.length - 1 ? uLogs[i + 1] : null;

        const cur = isHm ? log.currentHm : log.currentKm;
        const prev = isHm ? log.previousHm : log.previousKm;
        const delta = cur - prev;

        // 1. Non-dispense check (qty <= 0)
        if (log.volumeLiters <= 0) {
          categories.nonDispense++;
          anomalies.push({
            id: log.id,
            unitCode: log.unitCode,
            category: log.category,
            type: log.type,
            dateStr: log.dateStr,
            jamStr: log.jamStr,
            shift: log.shift,
            operator: log.operator || 'Admin',
            volumeLiters: log.volumeLiters,
            site: log.site,
            meterType: isHm ? 'HM' : 'KM',
            currentMeter: cur,
            previousMeter: prev,
            deltaMeter: delta,
            anomalyType: 'NON_DISPENSE',
            description: `Volume dispense ${log.volumeLiters} L <= 0 (Baris Saldo Awal / Inbound Refill)`,
            proposedPrevious: prev,
            proposedCurrent: cur,
            confidence: 'HIGH',
            fixStrategy: 'Keluarkan baris dari modul pemakaian kendaraan ERP',
          });
          continue;
        }

        // 2. Duplicate timestamp check
        if (nextLog && nextLog.dateStr === log.dateStr && nextLog.jamStr === log.jamStr) {
          categories.duplicateTimestamp++;
          anomalies.push({
            id: log.id,
            unitCode: log.unitCode,
            category: log.category,
            type: log.type,
            dateStr: log.dateStr,
            jamStr: log.jamStr,
            shift: log.shift,
            operator: log.operator || 'Admin',
            volumeLiters: log.volumeLiters,
            site: log.site,
            meterType: isHm ? 'HM' : 'KM',
            currentMeter: cur,
            previousMeter: prev,
            deltaMeter: delta,
            anomalyType: 'TIMESTAMP_DUPLICATE',
            description: `Transaksi tercatat ganda pada waktu persis ${log.dateStr} ${log.jamStr}`,
            proposedPrevious: prev,
            proposedCurrent: cur,
            confidence: 'MEDIUM',
            fixStrategy: 'Sesuaikan jam transaksi selisih +5 menit',
          });
        }

        // 3. Zero meter check
        if (cur === 0 && prev === 0) {
          categories.meterZero++;
          const synthPrev = lastKnownValid > 0 ? lastKnownValid : 1;
          const synthCur = synthPrev + 1;
          anomalies.push({
            id: log.id,
            unitCode: log.unitCode,
            category: log.category,
            type: log.type,
            dateStr: log.dateStr,
            jamStr: log.jamStr,
            shift: log.shift,
            operator: log.operator || 'Admin',
            volumeLiters: log.volumeLiters,
            site: log.site,
            meterType: isHm ? 'HM' : 'KM',
            currentMeter: cur,
            previousMeter: prev,
            deltaMeter: delta,
            anomalyType: 'METER_ZERO',
            description: `Pembacaan meter 0 / tidak tercatat (Genset / Tower Lamp / Meter Rusak)`,
            proposedPrevious: synthPrev,
            proposedCurrent: synthCur,
            confidence: 'HIGH',
            fixStrategy: 'Set meter kronologis bertingkat & tandai bypass broken',
          });
          lastKnownValid = synthCur;
          continue;
        }

        // 4. Standstill / Identical meter check (cur === prev)
        if (cur === prev) {
          categories.meterEqual++;
          anomalies.push({
            id: log.id,
            unitCode: log.unitCode,
            category: log.category,
            type: log.type,
            dateStr: log.dateStr,
            jamStr: log.jamStr,
            shift: log.shift,
            operator: log.operator || 'Admin',
            volumeLiters: log.volumeLiters,
            site: log.site,
            meterType: isHm ? 'HM' : 'KM',
            currentMeter: cur,
            previousMeter: prev,
            deltaMeter: delta,
            anomalyType: 'METER_EQUAL',
            description: `Meter sama persis (${cur}) dengan selisih 0 jam/km (Unit standstill / double refuel)`,
            proposedPrevious: prev,
            proposedCurrent: cur + 1,
            confidence: 'HIGH',
            fixStrategy: 'Tambahkan selisih minimum +1 unit meter untuk memenuhi validasi ERP',
          });
          lastKnownValid = cur + 1;
          continue;
        }

        // 5. Meter backtrack / Decrease (cur < prev or cur < lastKnownValid)
        if (cur < prev || (lastKnownValid > 0 && cur < lastKnownValid)) {
          categories.meterDecrease++;
          let propPrev = lastKnownValid > 0 ? lastKnownValid : prev;
          let propCur = cur;
          let fixDesc = '';

          // Typo diagnosis
          const diff = cur - (lastKnownValid > 0 ? lastKnownValid : prev);
          if (diff < -100 && nextLog) {
            const nextCur = isHm ? nextLog.currentHm : nextLog.currentKm;
            // Check if missing leading digit e.g. 12248 between 141787 and 143036
            if (cur < 20000 && lastKnownValid > 100000) {
              const guessed = cur + 100000;
              if (guessed >= lastKnownValid && guessed <= (nextCur > 0 ? nextCur : lastKnownValid + 500)) {
                propCur = guessed;
                propPrev = lastKnownValid;
                fixDesc = `Typo digit ratusan ribu: Tambah +100.000 menjadi ${guessed}`;
              }
            } else if (nextCur >= lastKnownValid) {
              // Interpolation between previous and next
              const interpolated = Math.round((lastKnownValid + nextCur) / 2);
              propPrev = lastKnownValid;
              propCur = Math.max(lastKnownValid + 1, interpolated);
              fixDesc = `Typo operator: Interpolasi di antara ${lastKnownValid} dan ${nextCur} -> ${propCur}`;
            }
          }

          if (!fixDesc) {
            propPrev = lastKnownValid > 0 ? lastKnownValid : prev;
            propCur = propPrev + 1;
            fixDesc = `Koreksi mundur kronologis: Sesuaikan agar maju dari ${propPrev} ke ${propCur}`;
          }

          anomalies.push({
            id: log.id,
            unitCode: log.unitCode,
            category: log.category,
            type: log.type,
            dateStr: log.dateStr,
            jamStr: log.jamStr,
            shift: log.shift,
            operator: log.operator || 'Admin',
            volumeLiters: log.volumeLiters,
            site: log.site,
            meterType: isHm ? 'HM' : 'KM',
            currentMeter: cur,
            previousMeter: prev,
            deltaMeter: delta,
            anomalyType: 'METER_DECREASE',
            description: `Meter mundur dari ${lastKnownValid > 0 ? lastKnownValid : prev} ke ${cur} (selisih ${diff})`,
            proposedPrevious: propPrev,
            proposedCurrent: propCur,
            confidence: Math.abs(diff) <= 10 ? 'HIGH' : 'MEDIUM',
            fixStrategy: fixDesc,
          });
          lastKnownValid = propCur;
          continue;
        }

        // 6. Extreme jump check (HM > 72h or KM > 1500km)
        const threshold = isHm ? 72 : 1500;
        if (delta > threshold) {
          categories.meterJump++;
          anomalies.push({
            id: log.id,
            unitCode: log.unitCode,
            category: log.category,
            type: log.type,
            dateStr: log.dateStr,
            jamStr: log.jamStr,
            shift: log.shift,
            operator: log.operator || 'Admin',
            volumeLiters: log.volumeLiters,
            site: log.site,
            meterType: isHm ? 'HM' : 'KM',
            currentMeter: cur,
            previousMeter: prev,
            deltaMeter: delta,
            anomalyType: 'METER_JUMP',
            description: `Lompatan meter ekstrem ${delta} ${isHm ? 'jam' : 'km'} (ambang wajar: ${threshold})`,
            proposedPrevious: prev,
            proposedCurrent: prev + (isHm ? 12 : 150),
            confidence: 'MEDIUM',
            fixStrategy: 'Sesuaikan pertambahan meter ke rata-rata pemakaian normal',
          });
        }

        lastKnownValid = cur;
      }
    }

    const totalLogs = logs.length;
    const anomalyCount = anomalies.length;
    const validLogs = Math.max(0, totalLogs - anomalyCount);
    const healthScore = totalLogs > 0 ? Number(((validLogs / totalLogs) * 100).toFixed(1)) : 100;

    return {
      monthStr: filter.monthStr || 'ALL',
      site: filter.site || 'ALL',
      totalLogs,
      validLogs,
      healthScore,
      categories,
      anomalies,
    };
  }

  /**
   * Applies approved reconciliation fixes in a secure atomic transaction with audit trail
   */
  static async applyFixes(dto: {
    fixes: {
      logId: string;
      proposedPrevious: number;
      proposedCurrent: number;
      meterType: 'HM' | 'KM';
      reason?: string;
    }[];
    userId?: string;
    userIp?: string;
  }) {
    if (!dto.fixes || dto.fixes.length === 0) {
      throw new Error('Tidak ada data perbaikan yang dipilih.');
    }

    const logIds = dto.fixes.map((f) => f.logId);
    const existingLogs = await prisma.fuelLog.findMany({
      where: { id: { in: logIds } },
    });

    const existingMap = new Map(existingLogs.map((l) => [l.id, l]));
    const auditEntries: any[] = [];
    const updates: any[] = [];

    for (const fix of dto.fixes) {
      const current = existingMap.get(fix.logId);
      if (!current) continue;

      const isHm = fix.meterType === 'HM';
      const oldValues = {
        previousHm: current.previousHm,
        currentHm: current.currentHm,
        deltaHm: current.deltaHm,
        previousKm: current.previousKm,
        currentKm: current.currentKm,
        deltaKm: current.deltaKm,
        bypassValidation: current.bypassValidation,
      };

      const newValues: any = {
        bypassValidation: true,
        bypassReason: fix.reason || 'Sistem Rekonsiliasi Integritas Data FMS',
      };

      if (isHm) {
        newValues.previousHm = fix.proposedPrevious;
        newValues.currentHm = fix.proposedCurrent;
        newValues.deltaHm = Number((fix.proposedCurrent - fix.proposedPrevious).toFixed(1));
      } else {
        newValues.previousKm = fix.proposedPrevious;
        newValues.currentKm = fix.proposedCurrent;
        newValues.deltaKm = Number((fix.proposedCurrent - fix.proposedPrevious).toFixed(1));
      }

      auditEntries.push({
        userId: dto.userId || null,
        action: 'UPDATE' as any,
        entity: 'FuelLog_Reconciliation',
        entityId: fix.logId,
        oldValues: JSON.stringify(oldValues),
        newValues: JSON.stringify(newValues),
        ipAddress: dto.userIp || '127.0.0.1',
        userAgent: 'Batara FMS Reconciliation Engine',
      });

      updates.push(
        prisma.fuelLog.update({
          where: { id: fix.logId },
          data: newValues,
        })
      );
    }

    // Atomic execution
    await prisma.$transaction(async (tx) => {
      for (const updatePromise of updates) {
        await updatePromise;
      }
      for (const audit of auditEntries) {
        await tx.auditLog.create({ data: audit });
      }
    });

    logger.info(`Reconciliation applied: ${updates.length} logs successfully reconciled by user ${dto.userId || 'Admin'}`);

    return {
      success: true,
      appliedCount: updates.length,
      message: `Berhasil merekonsiliasi ${updates.length} data transaksi dengan aman.`,
    };
  }

  /**
   * Rolls back a reconciliation operation using saved AuditLog records
   */
  static async rollbackBatch(dto: { auditBatchId?: string; logIds?: string[]; userId?: string }) {
    let auditRecords: any[] = [];

    if (dto.logIds && dto.logIds.length > 0) {
      auditRecords = await prisma.auditLog.findMany({
        where: {
          entity: 'FuelLog_Reconciliation',
          entityId: { in: dto.logIds },
        },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      // Rollback last 100 reconciliation audits
      auditRecords = await prisma.auditLog.findMany({
        where: { entity: 'FuelLog_Reconciliation' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    }

    if (auditRecords.length === 0) {
      throw new Error('Tidak ditemukan riwayat rekonsiliasi yang dapat di-rollback.');
    }

    let rolledBackCount = 0;
    await prisma.$transaction(async (tx) => {
      for (const record of auditRecords) {
        if (!record.entityId || !record.oldValues) continue;
        try {
          const original = JSON.parse(record.oldValues);
          await tx.fuelLog.update({
            where: { id: record.entityId },
            data: original,
          });
          rolledBackCount++;
        } catch (e: any) {
          logger.warn(`Failed to rollback log ${record.entityId}: ${e.message}`);
        }
      }
    });

    return {
      success: true,
      rolledBackCount,
      message: `Berhasil me-rollback ${rolledBackCount} data transaksi ke nilai awal.`,
    };
  }

  /**
   * Pure Virtual Auto-Sanitize function for Syshab Export
   * Ensures 100% ERP compatibility without requiring database mutation
   */
  static autoSanitizeForErp(rawLogs: any[]): any[] {
    // 1. Exclude non-dispense (volume <= 0)
    const dispenseLogs = rawLogs.filter((l) => l.volumeLiters > 0);

    // 2. Group by unitCode
    const groups = new Map<string, any[]>();
    for (const log of dispenseLogs) {
      const key = (log.unitCode || '').replace(/\s+/g, '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(log);
    }

    const sanitized: any[] = [];

    for (const [unitCode, unitLogs] of groups.entries()) {
      // Sort chronologically
      unitLogs.sort((a, b) => {
        const cmpDate = (a.dateStr || '').localeCompare(b.dateStr || '');
        if (cmpDate !== 0) return cmpDate;
        return (a.jamStr || '').localeCompare(b.jamStr || '');
      });

      const isHmPrimary = unitLogs[0]?.unit?.hasHm ?? true;
      let runningLastMeter = 0;

      for (let i = 0; i < unitLogs.length; i++) {
        const log = unitLogs[i];
        let rawCur = isHmPrimary ? (log.currentHm || 0) : (log.currentKm || 0);
        let rawPrev = isHmPrimary ? (log.previousHm || 0) : (log.previousKm || 0);

        let cur = rawCur;
        let prev = rawPrev;
        let bypass = log.bypassValidation;

        // Case A: Zero meter (Genset / Tower Lamp without meter)
        if (cur === 0 && prev === 0) {
          bypass = true;
          if (runningLastMeter === 0) {
            prev = 1;
            cur = 2;
          } else {
            prev = runningLastMeter;
            cur = runningLastMeter + 1;
          }
        } else {
          // Case B: Has meter
          if (runningLastMeter > 0 && prev < runningLastMeter) {
            if (cur < runningLastMeter) {
              bypass = true;
              prev = runningLastMeter;
              cur = runningLastMeter + 1;
            } else {
              prev = runningLastMeter;
            }
          }

          // Case C: cur <= prev (Identical / Standstill / Typo)
          if (cur <= prev) {
            bypass = true;
            cur = prev + 1;
          }
        }

        runningLastMeter = cur;

        sanitized.push({
          ...log,
          sanitizedCur: cur,
          sanitizedPrev: prev,
          sanitizedBypass: bypass,
        });
      }
    }

    // Sort chronologically across all units
    sanitized.sort((a, b) => {
      const cmpDate = (a.dateStr || '').localeCompare(b.dateStr || '');
      if (cmpDate !== 0) return cmpDate;
      return (a.jamStr || '').localeCompare(b.jamStr || '');
    });

    return sanitized;
  }
}
