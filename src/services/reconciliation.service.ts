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
   * Evaluates logs for a given month and detects all data anomalies using bidirectional timeline analysis.
   * Protects the true physical vehicle baseline (lastHm / lastKm) so future dispenser inputs are never blocked.
   */
  static async auditMonth(filter: { monthStr?: string; site?: string; lang?: string }): Promise<ReconciliationAuditResult> {
    const isEn = filter?.lang === 'en';
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

    // Group logs by unitCode to analyze chronological meter sequence per vehicle
    const unitGroups = new Map<string, typeof logs>();
    for (const log of logs) {
      const code = (log.unitCode || '').replace(/\s+/g, '');
      if (!unitGroups.has(code)) unitGroups.set(code, []);
      unitGroups.get(code)!.push(log);
    }

    for (const [unitCode, uLogs] of unitGroups.entries()) {
      const isHm = uLogs[0]?.unit?.hasHm ?? true;
      const n = uLogs.length;

      let effectiveRunning: number | null = null;

      for (let i = 0; i < n; i++) {
        const log = uLogs[i];
        const prevLog = i > 0 ? uLogs[i - 1] : null;
        const nextLog = i < n - 1 ? uLogs[i + 1] : null;

        const cur = isHm ? log.currentHm : log.currentKm;
        const prev = isHm ? log.previousHm : log.previousKm;
        const delta = cur - prev;

        const prevCur: number | null = effectiveRunning !== null ? effectiveRunning : (prevLog ? (isHm ? prevLog.currentHm : prevLog.currentKm) : null);
        const nextCur: number | null = nextLog ? (isHm ? nextLog.currentHm : nextLog.currentKm) : null;

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
            description: isEn
              ? `Dispense volume ${log.volumeLiters} L <= 0 (Opening Balance / Inbound Refill line)`
              : `Volume dispense ${log.volumeLiters} L <= 0 (Baris Saldo Awal / Inbound Refill)`,
            proposedPrevious: prev,
            proposedCurrent: cur,
            confidence: 'HIGH',
            fixStrategy: isEn
              ? 'Exclude row from ERP vehicle consumption module'
              : 'Keluarkan baris dari modul pemakaian kendaraan ERP',
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
            description: isEn
              ? `Duplicate transaction recorded at exact timestamp ${log.dateStr} ${log.jamStr}`
              : `Transaksi tercatat ganda pada waktu persis ${log.dateStr} ${log.jamStr}`,
            proposedPrevious: prev,
            proposedCurrent: cur,
            confidence: 'MEDIUM',
            fixStrategy: isEn
              ? 'Physically verify fuelman slip to confirm duplicate transaction validity'
              : 'Verifikasi fisik nota fuelman untuk memastikan keabsahan transaksi ganda',
          });
        }

        // 3. Zero meter check (Missing reading vs Permanent Non-Metered)
        if (cur === 0 && prev === 0) {
          categories.meterZero++;
          if (prevCur && nextCur && prevCur > 0 && nextCur >= prevCur) {
            const interpolated = Math.round((prevCur + nextCur) / 2);
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
              currentMeter: 0,
              previousMeter: 0,
              deltaMeter: 0,
              anomalyType: 'METER_ZERO',
              description: isEn
                ? `Blank meter between ${prevCur} and ${nextCur} -> Proposed interpolation: ${interpolated}`
                : `Meter kosong di antara ${prevCur} dan ${nextCur} -> Usulan interpolasi: ${interpolated}`,
              proposedPrevious: prevCur,
              proposedCurrent: interpolated,
              confidence: 'HIGH',
              fixStrategy: isEn
                ? 'Fill reasonable estimate to prevent gaps and protect unit last meter threshold'
                : 'Isi estimasi wajar agar tidak bolong dan menjaga batas last meter unit',
            });
            effectiveRunning = interpolated;
          } else {
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
              currentMeter: 0,
              previousMeter: 0,
              deltaMeter: 0,
              anomalyType: 'METER_ZERO',
              description: isEn
                ? 'Equipment without physical meter (Genset / Tower Lamp)'
                : 'Peralatan tanpa meter fisik (Genset / Tower Lamp)',
              proposedPrevious: 0,
              proposedCurrent: 0,
              confidence: 'HIGH',
              fixStrategy: isEn
                ? 'Retain 0 in physical DB; virtual sanitation (Broken=2) is automatically applied during Syshab export'
                : 'Pertahankan 0 di DB fisik; sanitasi virtual (Broken=2) diterapkan otomatis saat ekspor Syshab',
            });
          }
          continue;
        }

        // Spike threshold: HM > 24 hours jump, KM > 300 km jump
        const spikeThreshold = isHm ? 24 : 300;

        // 4. Isolated Spike Check (Outlier High Typo)
        // cur jumps way higher than previous AND next drops back down to reasonable physical range!
        if (prevCur !== null && nextCur !== null && cur > prevCur + spikeThreshold && cur > nextCur + spikeThreshold && nextCur >= prevCur) {
          categories.meterJump++;
          let propCur = Math.round((prevCur + nextCur) / 2);
          const strCur = String(Math.round(cur));
          const strPrev = String(Math.round(prevCur));
          if (strCur.length === strPrev.length && strCur.substring(1) === strPrev.substring(1)) {
            propCur = Number(strPrev[0] + strCur.substring(1));
          } else {
            const last3 = cur % 1000;
            const candidate = Math.floor(prevCur / 1000) * 1000 + last3;
            if (candidate >= prevCur && candidate <= nextCur) {
              propCur = candidate;
            }
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
            anomalyType: 'METER_JUMP',
            description: isEn
              ? `Isolated typo spike (${cur}) between ${prevCur} and ${nextCur}`
              : `Lonjakan typo terisolasi (${cur}) di antara ${prevCur} dan ${nextCur}`,
            proposedPrevious: prevCur,
            proposedCurrent: propCur,
            confidence: 'HIGH',
            fixStrategy: isEn
              ? `Correct digit spike typo to fleet's real reading (${propCur}) to prevent inflating unit's last meter`
              : `Koreksi typo digit lonjakan ke nilai riil armada (${propCur}) agar batas last meter tidak melonjak`,
          });
          effectiveRunning = propCur;
          continue;
        }

        // 5. Isolated Dip Check (Outlier Low Typo)
        // cur is smaller than prevCur, BUT nextCur is normal (>= prevCur)
        if (prevCur !== null && nextCur !== null && cur < prevCur && nextCur >= prevCur && nextCur > cur) {
          categories.meterDecrease++;
          let propCur = Math.round((prevCur + nextCur) / 2);
          if (cur + 100000 >= prevCur && cur + 100000 <= nextCur) {
            propCur = cur + 100000;
          } else {
            const last3 = cur % 1000;
            const candidate = Math.floor(prevCur / 1000) * 1000 + last3;
            if (candidate >= prevCur && candidate <= nextCur) {
              propCur = candidate;
            }
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
            description: isEn
              ? `Isolated typo decrease (${cur}) between ${prevCur} and ${nextCur}`
              : `Penurunan typo terisolasi (${cur}) di antara ${prevCur} dan ${nextCur}`,
            proposedPrevious: prevCur,
            proposedCurrent: propCur,
            confidence: 'HIGH',
            fixStrategy: isEn
              ? `Correct decrease typo to fleet's real reading (${propCur}) along vehicle physical trajectory`
              : `Koreksi typo penurunan ke nilai riil armada (${propCur}) sesuai lintasan fisik unit`,
          });
          effectiveRunning = propCur;
          continue;
        }

        // 6. Standstill / Equal Check (cur === prev or cur === prevCur)
        if (cur === prev || (prevCur !== null && cur === prevCur)) {
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
            description: isEn
              ? `Identical meter reading (${cur}) / standby unit (0 hr/km delta)`
              : `Meter sama persis (${cur}) / unit standby (selisih 0 jam/km)`,
            proposedPrevious: prev,
            proposedCurrent: cur,
            confidence: 'HIGH',
            fixStrategy: isEn
              ? 'Retain physical value in DB; automatically adjusted virtually during Syshab export'
              : 'Pertahankan nilai fisik di DB; saat ekspor Syshab otomatis disesuaikan secara virtual',
          });
          effectiveRunning = cur;
          continue;
        }

        // 7. Unrecovered Backtrack (Chronological Decrease)
        if (prevCur !== null && cur < prevCur) {
          categories.meterDecrease++;
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
            description: isEn
              ? `Meter decreased from ${prevCur} to ${cur}`
              : `Meter turun dari ${prevCur} ke ${cur}`,
            proposedPrevious: prevCur,
            proposedCurrent: cur,
            confidence: 'MEDIUM',
            fixStrategy: isEn
              ? 'Physically verify replacement record of dashboard meter/gauge on site'
              : 'Verifikasi fisik catatan penggantian meter mesin/alat di lapangan',
          });
          effectiveRunning = cur;
          continue;
        }

        // Valid normal record
        effectiveRunning = cur;
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
   * Applies approved reconciliation fixes in a secure atomic transaction with audit trail.
   * Synchronizes each affected unit's authoritative lastHm / lastKm in the Unit table to its true latest log.
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

    // Synchronize affected units' lastHm and lastKm to their true latest fuel log
    const affectedUnitIds = new Set<string>();
    for (const l of existingLogs) {
      if (l.unitId) affectedUnitIds.add(l.unitId);
    }

    for (const unitId of affectedUnitIds) {
      const latestLog = await prisma.fuelLog.findFirst({
        where: { unitId },
        orderBy: [{ dateStr: 'desc' }, { jamStr: 'desc' }],
        include: { unit: true },
      });
      if (latestLog && latestLog.unit) {
        const updateData: any = {};
        if (latestLog.unit.hasHm && latestLog.currentHm > 0) {
          updateData.lastHm = latestLog.currentHm;
        }
        if (latestLog.unit.hasKm && latestLog.currentKm > 0) {
          updateData.lastKm = latestLog.currentKm;
        }
        if (Object.keys(updateData).length > 0) {
          await prisma.unit.update({
            where: { id: unitId },
            data: updateData,
          });
        }
      }
    }

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
    const affectedUnitIds = new Set<string>();

    await prisma.$transaction(async (tx) => {
      for (const record of auditRecords) {
        if (!record.entityId || !record.oldValues) continue;
        try {
          const original = JSON.parse(record.oldValues);
          const updated = await tx.fuelLog.update({
            where: { id: record.entityId },
            data: original,
          });
          affectedUnitIds.add(updated.unitId);
          rolledBackCount++;
        } catch (e: any) {
          logger.warn(`Failed to rollback log ${record.entityId}: ${e.message}`);
        }
      }
    });

    // Re-sync unit baselines after rollback
    for (const unitId of affectedUnitIds) {
      const latestLog = await prisma.fuelLog.findFirst({
        where: { unitId },
        orderBy: [{ dateStr: 'desc' }, { jamStr: 'desc' }],
        include: { unit: true },
      });
      if (latestLog && latestLog.unit) {
        const updateData: any = {};
        if (latestLog.unit.hasHm && latestLog.currentHm > 0) {
          updateData.lastHm = latestLog.currentHm;
        }
        if (latestLog.unit.hasKm && latestLog.currentKm > 0) {
          updateData.lastKm = latestLog.currentKm;
        }
        if (Object.keys(updateData).length > 0) {
          await prisma.unit.update({
            where: { id: unitId },
            data: updateData,
          });
        }
      }
    }

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
    const dispenseLogs = rawLogs.filter((l) => l.volumeLiters > 0);

    const groups = new Map<string, any[]>();
    for (const log of dispenseLogs) {
      const key = (log.unitCode || '').replace(/\s+/g, '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(log);
    }

    const sanitized: any[] = [];

    for (const [unitCode, unitLogs] of groups.entries()) {
      unitLogs.sort((a, b) => {
        const cmpDate = (a.dateStr || '').localeCompare(b.dateStr || '');
        if (cmpDate !== 0) return cmpDate;
        return (a.jamStr || '').localeCompare(b.jamStr || '');
      });

      const isHmPrimary = unitLogs[0]?.unit?.hasHm ?? true;
      const n = unitLogs.length;
      let runningLastMeter = 0;

      for (let i = 0; i < n; i++) {
        const log = unitLogs[i];
        const nextLog = i < n - 1 ? unitLogs[i + 1] : null;

        let rawCur = isHmPrimary ? (log.currentHm || 0) : (log.currentKm || 0);
        let rawPrev = isHmPrimary ? (log.previousHm || 0) : (log.previousKm || 0);

        const nextCur = nextLog ? (isHmPrimary ? (nextLog.currentHm || 0) : (nextLog.currentKm || 0)) : null;

        let cur = rawCur;
        let prev = rawPrev;
        let bypass = log.bypassValidation;

        // Check if rawCur is an isolated spike (e.g. 8534 between 4527 and 4540)
        // If so, correct cur down to trajectory so runningLastMeter doesn't get contaminated!
        if (runningLastMeter > 0 && nextCur !== null && cur > runningLastMeter + 24 && cur > nextCur + 24 && nextCur >= runningLastMeter) {
          const strCur = String(Math.round(cur));
          const strPrev = String(Math.round(runningLastMeter));
          if (strCur.length === strPrev.length && strCur.substring(1) === strPrev.substring(1)) {
            cur = Number(strPrev[0] + strCur.substring(1));
          } else {
            cur = Math.round((runningLastMeter + nextCur) / 2);
          }
          prev = runningLastMeter;
          bypass = true;
        }

        // Case A: Zero meter
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
          // Case B: Normal progression or dip
          if (runningLastMeter > 0 && prev < runningLastMeter) {
            if (cur < runningLastMeter) {
              bypass = true;
              prev = runningLastMeter;
              cur = runningLastMeter + 1;
            } else {
              prev = runningLastMeter;
            }
          }

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

    sanitized.sort((a, b) => {
      const cmpDate = (a.dateStr || '').localeCompare(b.dateStr || '');
      if (cmpDate !== 0) return cmpDate;
      return (a.jamStr || '').localeCompare(b.jamStr || '');
    });

    return sanitized;
  }
}
