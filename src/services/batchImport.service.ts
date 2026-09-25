import ExcelJS from 'exceljs';
import { prisma } from '../config/prisma.js';
import { UnitCategory, SyncStatus, AuditAction } from '@prisma/client';
import { AuditService } from './audit.service.js';
import { AuthenticatedUser } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class BatchImportService {
  private static unitCategoryMap: Record<string, UnitCategory> = {
    'DUMP TRUCK': UnitCategory.DUMP_TRUCK,
    'DUMP_TRUCK': UnitCategory.DUMP_TRUCK,
    'DT': UnitCategory.DUMP_TRUCK,
    'HEAVY EQUIPMENT': UnitCategory.HEAVY_EQUIPMENT,
    'HEAVY_EQUIPMENT': UnitCategory.HEAVY_EQUIPMENT,
    'EXCAVATOR': UnitCategory.HEAVY_EQUIPMENT,
    'DOZER': UnitCategory.HEAVY_EQUIPMENT,
    'LOADER': UnitCategory.HEAVY_EQUIPMENT,
    'GRADER': UnitCategory.HEAVY_EQUIPMENT,
    'SUPPORT': UnitCategory.SUPPORT_VEHICLE,
    'SUPPORT VEHICLE': UnitCategory.SUPPORT_VEHICLE,
    'SUPPORT_VEHICLE': UnitCategory.SUPPORT_VEHICLE,
    'WATER TRUCK': UnitCategory.SUPPORT_VEHICLE,
    'FUEL TRUCK': UnitCategory.SUPPORT_VEHICLE,
    'GENERATOR': UnitCategory.GENERATOR,
    'GENSET': UnitCategory.GENERATOR,
    'GEN': UnitCategory.GENERATOR,
    'LIGHT VEHICLE': UnitCategory.LIGHT_VEHICLE,
    'LIGHT_VEHICLE': UnitCategory.LIGHT_VEHICLE,
    'LV': UnitCategory.LIGHT_VEHICLE,
    'PATROL': UnitCategory.LIGHT_VEHICLE,
  };

  static isValidUnitCode(rawCode: string): boolean {
    if (!rawCode) return false;
    const code = rawCode.trim();
    const upper = code.toUpperCase();
    const lower = code.toLowerCase();

    // Skip headers, notes, sentences, dates, or pure numbers
    if (
      code.length === 0 ||
      code.length > 25 ||
      code.includes('GMT+') ||
      code.includes('Western Indonesia Time') ||
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /i.test(code) ||
      /^\d+$/.test(code) ||
      lower.includes('unit') ||
      lower.includes('total') ||
      lower.includes('kategori') ||
      lower.includes('qty') ||
      lower.includes('count of') ||
      lower.includes('sum of') ||
      lower.includes('tanggal') ||
      lower.includes('remarks') ||
      lower.includes('nama') ||
      lower.includes('jam selesai') ||
      lower.includes('karena') ||
      lower.includes('dikarenakan') ||
      lower.includes('sehingga') ||
      lower.includes('dan juga') ||
      lower.includes('izin') ||
      lower.includes('roster') ||
      lower.includes('refuelling') ||
      lower.includes('agar kiranya') ||
      ['AGUNG HIO', 'ALFONSUS', 'MADHAN', 'WAHYU', 'YAHYA', 'PENGISIAN ELNUSA'].includes(upper)
    ) {
      return false;
    }
    return true;
  }

  private static extractCellValue(cell: any): any {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    const val = cell.value;
    if (typeof val === 'object') {
      if (val instanceof Date) return val;
      if ('result' in val) return (val as any).result ?? '';
      if ('text' in val) return (val as any).text ?? '';
      if ('richText' in val && Array.isArray((val as any).richText)) {
        return (val as any).richText.map((rt: any) => rt.text).join('');
      }
    }
    return val;
  }

  private static parseExcelDate(rawDate: any): string | null {
    if (!rawDate) return null;
    if (rawDate instanceof Date) {
      const y = rawDate.getUTCFullYear();
      if (y < 2020 || y > 2050) return null;
      const m = String(rawDate.getUTCMonth() + 1).padStart(2, '0');
      const d = String(rawDate.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    if (typeof rawDate === 'number') {
      const parsed = new Date((rawDate - (25567 + 2)) * 86400 * 1000);
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getUTCFullYear();
        if (y >= 2020 && y <= 2050) {
          const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
          const d = String(parsed.getUTCDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
      }
      return null;
    }
    if (typeof rawDate === 'string' && rawDate.trim()) {
      const clean = rawDate.trim();
      const monthMap: Record<string, string> = {
        jan: '01', feb: '02', mar: '03', apr: '04', mei: '05', may: '05',
        jun: '06', jul: '07', agu: '08', aug: '08', sep: '09', okt: '10',
        oct: '10', nov: '11', des: '12', dec: '12',
      };
      const textMatch = clean.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{2,4})$/);
      if (textMatch) {
        const d = textMatch[1].padStart(2, '0');
        const m = monthMap[textMatch[2].toLowerCase()] || '01';
        const y = textMatch[3].length === 2 ? `20${textMatch[3]}` : textMatch[3];
        const numY = parseInt(y, 10);
        if (numY >= 2020 && numY <= 2050) {
          return `${y}-${m}-${d}`;
        }
      }
      if (clean.includes('-')) {
        const parts = clean.split('-');
        if (parts.length === 3 && parts[0].length === 4) {
          const numY = parseInt(parts[0], 10);
          if (numY >= 2020 && numY <= 2050) return clean;
        }
      }
      if (clean.includes('/')) {
        const parts = clean.split('/');
        if (parts.length === 3) {
          const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
          const numY = parseInt(y, 10);
          if (numY >= 2020 && numY <= 2050) {
            return `${y}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
        }
      }
    }
    return null;
  }

  private static parseExcelTime(rawJam: any): string {
    if (!rawJam) return '00:00';
    if (rawJam instanceof Date) {
      const hh = String(rawJam.getUTCHours()).padStart(2, '0');
      const mm = String(rawJam.getUTCMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    if (typeof rawJam === 'number') {
      const totalSeconds = Math.round(rawJam * 86400);
      const hh = String(Math.floor(totalSeconds / 3600) % 24).padStart(2, '0');
      const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    const str = String(rawJam).trim();
    if (!str || str === '-' || str === '0') return '00:00';

    // Normalize separators and common human typos (e.g. ';' -> ':', '.' -> ':', '21:l20' -> '21:20')
    const normalized = str
      .replace(/;/g, ':')
      .replace(/\./g, ':')
      .replace(/[oO]/g, '0')
      .replace(/[^\d:]/g, ''); // strips non-digits and non-colons like 'l', 'k', spaces

    const parts = normalized.split(':').filter(Boolean);
    if (parts.length >= 2) {
      const hh = parseInt(parts[0].slice(0, 2), 10);
      const mm = parseInt(parts[1].slice(0, 2), 10);
      if (!isNaN(hh) && !isNaN(mm) && hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    } else if (parts.length === 1 && parts[0].length === 4) {
      // Handles 4-digit military time without colon e.g. "2120" -> "21:20"
      const hh = parseInt(parts[0].slice(0, 2), 10);
      const mm = parseInt(parts[0].slice(2, 4), 10);
      if (!isNaN(hh) && !isNaN(mm) && hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }

    // Secondary regex match on original string
    const match = str.match(/(\d{1,2})[:.](\d{1,2})/);
    if (match) {
      const hh = parseInt(match[1], 10);
      const mm = parseInt(match[2], 10);
      if (!isNaN(hh) && !isNaN(mm) && hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
    }

    return '00:00';
  }

  private static parseDispensedAt(dateStr: string, jamStr: string): Date {
    try {
      let timePart = '12:00:00';
      if (jamStr && jamStr.includes(':')) {
        const parts = jamStr.split(':').map((p) => p.trim());
        if (parts.length >= 2) {
          const h = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const s = parts[2] ? parseInt(parts[2], 10) : 0;
          if (!isNaN(h) && !isNaN(m) && h >= 0 && h < 24 && m >= 0 && m < 60) {
            timePart = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(!isNaN(s) && s >= 0 && s < 60 ? s : 0).padStart(2, '0')}`;
          }
        }
      }
      const parsed = new Date(`${dateStr}T${timePart}.000Z`);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    } catch {
      // fallback
    }

    try {
      const fallback = new Date(`${dateStr}T12:00:00.000Z`);
      if (!isNaN(fallback.getTime())) {
        return fallback;
      }
    } catch {
      // fallback
    }

    return new Date();
  }

  /**
   * Imports multi-month historical Excel fuel logs adhering to the 15 columns:
   * [NO, NO UNIT, KATEGORI, DATE, JAM, HM, KM, QTY OUT ( LITER ), SHIFT, OPERATOR, FUEL IN, TOTAL FUEL OUT, STOCK AKHIR, TOTAL FUEL IN, FUELMAN]
   */
  static async importLegacyExcel(
    buffer: Buffer,
    currentUser: AuthenticatedUser,
    options?: { defaultTankId?: string }
  ) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    let defaultTank = options?.defaultTankId
      ? await prisma.storageTank.findUnique({ where: { id: options.defaultTankId } })
      : await prisma.storageTank.findFirst({ where: { tankCode: 'TANK-MAIN-01' } });

    if (!defaultTank) {
      defaultTank = await prisma.storageTank.findFirst();
    }
    if (!defaultTank) {
      defaultTank = await prisma.storageTank.create({
        data: {
          tankCode: 'TANK-MAIN-01',
          name: 'Main Storage Tank 01',
          capacityLiters: 50000.0,
          currentStockLiters: 45000.0,
          minStockAlertLiters: 5000.0,
          fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
        },
      });
    }

    const report = {
      sheetsProcessed: 0,
      totalRowsScanned: 0,
      unitsCreated: 0,
      unitsUpdated: 0,
      logsImported: 0,
      skippedRows: 0,
      errors: [] as string[],
    };

    // Cache units in memory to minimize DB roundtrips during bulk processing
    const existingUnits = await prisma.unit.findMany();
    const unitMap = new Map<string, { id: string; category: UnitCategory; lastKm: number; lastHm: number }>();
    for (const u of existingUnits) {
      unitMap.set(u.unitCode.toUpperCase(), { id: u.id, category: u.category, lastKm: u.lastKm, lastHm: u.lastHm });
    }

    let initialLogCount = await prisma.fuelLog.count();
    const parsedLogs: any[] = [];
    let lastKnownStockAkhir: number | null = null;

    // 0. Filter to primary operational ledger worksheet(s)
    const primaryLedgers = workbook.worksheets.filter((ws) => {
      const name = ws.name.toLowerCase().trim();
      return name.includes('bio solar') || name.includes('pengambilan') || name.includes('pemakaian');
    });

    const targetWorksheets = primaryLedgers.length > 0
      ? primaryLedgers
      : workbook.worksheets.filter((ws) => {
          const name = ws.name.toLowerCase().trim();
          return !['pivot', 'resume', 'dashboard', 'sheet', 'checklist', 'absensi', 'summary'].some((kw) => name.includes(kw));
        });

    for (const worksheet of targetWorksheets) {
      report.sheetsProcessed++;
      const sheetName = worksheet.name;
      logger.info(`Processing worksheet: ${sheetName}`);

      // 1. Detect header row by scanning rows 1..10 for key column names
      let headerRowIndex = 1;
      const colMap = {
        no: 1,
        unitCode: 2,
        category: 3,
        date: 4,
        jam: 5,
        hm: 6,
        km: 7,
        qtyOut: 8,
        shift: 9,
        operator: 10,
        fuelIn: 11,
        totalFuelOut: 12,
        stockAkhir: 13,
        totalFuelIn: 14,
        fuelman: 15,
      };

      for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
        const row = worksheet.getRow(r);
        const headers: { col: number; text: string }[] = [];
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const val = String(this.extractCellValue(cell) || '').trim().toUpperCase();
          if (val) headers.push({ col: colNumber, text: val });
        });

        const hasUnit = headers.some((h) => h.text.includes('UNIT') || h.text === 'WS');
        const hasDate = headers.some((h) => h.text.includes('DATE') || h.text.includes('TANGGAL') || h.text.includes('TGL'));
        const hasQty = headers.some((h) => h.text.includes('QTY') || h.text.includes('LITER') || h.text.includes('VOLUME'));

        if (hasUnit && (hasDate || hasQty)) {
          headerRowIndex = r;
          for (const h of headers) {
            const t = h.text;
            if (t === 'NO' || t === 'NO.') colMap.no = h.col;
            else if (t.includes('UNIT') || t === 'WS' || t === 'EQUIPMENT') colMap.unitCode = h.col;
            else if (t.includes('KATEGORI') || t.includes('CATEGORY')) colMap.category = h.col;
            else if (t.includes('TANGGAL') || t.includes('DATE') || t.includes('TGL')) colMap.date = h.col;
            else if (t.includes('JAM MASUK') || (t.includes('JAM') && !t.includes('SELESAI')) || t.includes('TIME')) colMap.jam = h.col;
            else if (t === 'HM' || t.includes('HOUR METER') || t.includes('HOUR')) colMap.hm = h.col;
            else if (t === 'KM' || t.includes('ODOMETER')) colMap.km = h.col;
            else if (t.includes('QTY') || (t.includes('OUT') && t.includes('LITER')) || t.includes('VOLUME')) colMap.qtyOut = h.col;
            else if (t.includes('SHIFT')) colMap.shift = h.col;
            else if (t.includes('OPERATOR') || t.includes('DRIVER')) colMap.operator = h.col;
            else if (t === 'FUEL IN' || t.includes('PENGISIAN')) colMap.fuelIn = h.col;
            else if (t.includes('TOTAL FUEL OUT')) colMap.totalFuelOut = h.col;
            else if (t.includes('STOCK AKHIR') || t.includes('SISA STOK') || t.includes('SALDO AKHIR')) colMap.stockAkhir = h.col;
            else if (t.includes('TOTAL FUEL IN')) colMap.totalFuelIn = h.col;
            else if (t.includes('FUELMAN') || t.includes('OFFICER') || t.includes('PETUGAS')) colMap.fuelman = h.col;
          }
          logger.info(`Detected header row ${r} in sheet "${sheetName}". Resolved dynamic columns:`, colMap);
          break;
        }
      }

      worksheet.eachRow((row, rowNumber) => {
        // Skip header rows
        if (rowNumber <= headerRowIndex) return;

        try {
          const rawNo = this.extractCellValue(row.getCell(colMap.no));
          const rawUnitCode = String(this.extractCellValue(row.getCell(colMap.unitCode)) || '').trim();
          const rawCategory = String(this.extractCellValue(row.getCell(colMap.category)) || '').trim().toUpperCase();
          const rawDate = this.extractCellValue(row.getCell(colMap.date));
          const rawJam = this.extractCellValue(row.getCell(colMap.jam));
          const rawHm = parseFloat(this.extractCellValue(row.getCell(colMap.hm))) || 0;
          const rawKm = parseFloat(this.extractCellValue(row.getCell(colMap.km))) || 0;
          const rawQtyOut = parseFloat(this.extractCellValue(row.getCell(colMap.qtyOut))) || 0;
          const rawShift = String(this.extractCellValue(row.getCell(colMap.shift)) || '1').trim();
          const rawOperator = String(this.extractCellValue(row.getCell(colMap.operator)) || '-').trim();
          const rawFuelIn = parseFloat(this.extractCellValue(row.getCell(colMap.fuelIn))) || 0;
          const rawTotalFuelOut = parseFloat(this.extractCellValue(row.getCell(colMap.totalFuelOut))) || 0;
          const rawStockAkhir = parseFloat(this.extractCellValue(row.getCell(colMap.stockAkhir))) || 0;
          const rawTotalFuelIn = parseFloat(this.extractCellValue(row.getCell(colMap.totalFuelIn))) || 0;
          const rawFuelman = String(this.extractCellValue(row.getCell(colMap.fuelman)) || '').trim();

          // Skip invalid rows, headers, notes, or summary totals
          if (!BatchImportService.isValidUnitCode(rawUnitCode)) {
            report.skippedRows++;
            return;
          }

          report.totalRowsScanned++;

          const dateStr = this.parseExcelDate(rawDate);
          if (!dateStr) {
            report.skippedRows++;
            return;
          }
          const jamStr = this.parseExcelTime(rawJam);

          // Category mapping
          const mappedCategory = this.unitCategoryMap[rawCategory] || UnitCategory.DUMP_TRUCK;
          const unitCodeKey = rawUnitCode.toUpperCase();

          parsedLogs.push({
            no: parseInt(String(rawNo), 10) || report.totalRowsScanned,
            unitCodeKey,
            rawUnitCode,
            category: mappedCategory,
            dateStr,
            jamStr,
            currentHm: rawHm,
            currentKm: rawKm,
            volumeLiters: rawQtyOut,
            shift: rawShift,
            operator: rawOperator,
            fuelInLiters: rawFuelIn,
            totalFuelOut: rawTotalFuelOut,
            stockAkhir: rawStockAkhir,
            totalFuelIn: rawTotalFuelIn,
            fuelmanName: rawFuelman,
          });

          if (rawStockAkhir > 0) {
            lastKnownStockAkhir = rawStockAkhir;
          }
        } catch (err: any) {
          report.errors.push(`Sheet "${sheetName}" Row ${rowNumber}: ${err.message}`);
        }
      });
    }

    // Process all identified units: track chronologically latest readings
    const distinctUnitsToEnsure = new Map<string, { unitCode: string; category: UnitCategory; lastKm: number; lastHm: number; orderKey: string }>();
    for (const item of parsedLogs) {
      const orderKey = `${item.dateStr}_${item.jamStr}_${String(item.no).padStart(6, '0')}`;
      const existing = distinctUnitsToEnsure.get(item.unitCodeKey);
      if (!existing) {
        distinctUnitsToEnsure.set(item.unitCodeKey, {
          unitCode: item.rawUnitCode,
          category: item.category,
          lastKm: item.currentKm,
          lastHm: item.currentHm,
          orderKey,
        });
      } else if (orderKey >= existing.orderKey) {
        existing.lastKm = item.currentKm;
        existing.lastHm = item.currentHm;
        existing.orderKey = orderKey;
      }
    }

    // Upsert any missing units into DB
    for (const [codeKey, uData] of distinctUnitsToEnsure.entries()) {
      if (!unitMap.has(codeKey)) {
        try {
          const created = await prisma.unit.create({
            data: {
              unitCode: uData.unitCode,
              category: uData.category,
              lastKm: uData.lastKm,
              lastHm: uData.lastHm,
              isActive: true,
            },
          });
          unitMap.set(codeKey, {
            id: created.id,
            category: created.category,
            lastKm: created.lastKm,
            lastHm: created.lastHm,
          });
          report.unitsCreated++;
        } catch (e: any) {
          logger.warn(`Could not auto-create unit ${uData.unitCode}: ${e.message}`);
        }
      }
    }

    // In-memory deduplication
    const uniqueParsedLogs: typeof parsedLogs = [];
    const seenLogKeys = new Set<string>();
    for (const item of parsedLogs) {
      const key = `${item.dateStr}_${item.jamStr}_${item.unitCodeKey}_${item.no}_${item.volumeLiters}_${item.fuelInLiters}`;
      if (!seenLogKeys.has(key)) {
        seenLogKeys.add(key);
        uniqueParsedLogs.push(item);
      } else {
        report.skippedRows++;
      }
    }

    // Insert FuelLogs in batch chunks
    const chunkSize = 100;
    const now = new Date();

    for (let i = 0; i < uniqueParsedLogs.length; i += chunkSize) {
      const chunk = uniqueParsedLogs.slice(i, i + chunkSize);
      const rowsToInsert = chunk.map((item, idx) => {
        const globalIdx = initialLogCount + i + idx + 1;
        const unit = unitMap.get(item.unitCodeKey);
        const dateClean = item.dateStr.replace(/-/g, '');
        const cleanNo = item.no || globalIdx;
        const hashSeed = `${item.unitCodeKey}_${item.jamStr}_${item.volumeLiters}_${item.fuelInLiters}`;
        let hash = 0;
        for (let c = 0; c < hashSeed.length; c++) {
          hash = (hash * 31 + hashSeed.charCodeAt(c)) >>> 0;
        }
        const suffix = hash.toString(36).toUpperCase().padStart(4, '0').slice(-4);
        const logNumber = `LOG-${dateClean}-${String(cleanNo).padStart(6, '0')}-${suffix}`;

        // Estimate previous values
        const prevKm = Math.max(0, item.currentKm > 0 ? item.currentKm - 20 : 0);
        const prevHm = Math.max(0, item.currentHm > 0 ? item.currentHm - 1 : 0);
        const deltaKm = parseFloat(Math.max(0, item.currentKm - prevKm).toFixed(2));
        const deltaHm = parseFloat(Math.max(0, item.currentHm - prevHm).toFixed(2));

        return {
          logNumber,
          no: item.no || globalIdx,
          unitId: unit ? unit.id : defaultTank!.id, // fallback
          fuelmanId: currentUser.id,
          tankId: defaultTank!.id,
          unitCode: item.rawUnitCode,
          category: item.category,
          dateStr: item.dateStr,
          jamStr: item.jamStr,
          previousHm: prevHm,
          currentHm: item.currentHm,
          deltaHm,
          previousKm: prevKm,
          currentKm: item.currentKm,
          deltaKm,
          volumeLiters: item.volumeLiters,
          shift: item.shift,
          operator: item.operator,
          fuelInLiters: item.fuelInLiters,
          totalFuelOut: item.totalFuelOut,
          stockAkhir: item.stockAkhir,
          totalFuelIn: item.totalFuelIn,
          fuelmanName: item.fuelmanName,
          bypassValidation: true,
          bypassReason: 'Historical Legacy Batch Import',
          dispensedAt: this.parseDispensedAt(item.dateStr, item.jamStr),
          syncStatus: SyncStatus.SYNCED,
          createdAt: now,
          updatedAt: now,
        };
      });

      try {
        await prisma.fuelLog.createMany({
          data: rowsToInsert,
          skipDuplicates: true,
        });
        report.logsImported += rowsToInsert.length;
      } catch (err: any) {
        logger.warn(`Batch chunk [${i}..${i + chunkSize}] bulk insert failed, attempting row-by-row fallback: ${err.message}`);
        for (const row of rowsToInsert) {
          try {
            await prisma.fuelLog.create({
              data: row,
            });
            report.logsImported++;
          } catch (rowErr: any) {
            report.errors.push(`Row #${row.no} (${row.unitCode}): ${rowErr.message}`);
          }
        }
      }
    }

    // Update storage tank stock if historical final stock was captured
    if (lastKnownStockAkhir !== null && lastKnownStockAkhir > 0) {
      await prisma.storageTank.update({
        where: { id: defaultTank.id },
        data: { currentStockLiters: Math.min(defaultTank.capacityLiters, lastKnownStockAkhir) },
      });
    }

    // Synchronize all unit baseline meters with their chronologically latest fuel logs
    try {
      await prisma.$executeRaw`
        WITH latest_logs AS (
          SELECT DISTINCT ON ("unitId")
            "unitId",
            "currentKm",
            "currentHm"
          FROM "FuelLog"
          WHERE "unitId" IS NOT NULL
          ORDER BY "unitId", "dateStr" DESC, "jamStr" DESC, "no" DESC
        )
        UPDATE "Unit" u
        SET
          "lastKm" = l."currentKm",
          "lastHm" = l."currentHm"
        FROM latest_logs l
        WHERE u.id = l."unitId";
      `;
    } catch (e: any) {
      logger.warn(`Could not sync unit baseline meters: ${e.message}`);
    }

    // Record Audit Log
    await AuditService.log({
      userId: currentUser.id,
      action: AuditAction.BATCH_IMPORT,
      entity: 'FuelLog',
      newValues: {
        sheetsCount: report.sheetsProcessed,
        rowsScanned: report.totalRowsScanned,
        logsImported: report.logsImported,
        unitsCreated: report.unitsCreated,
        unitsUpdated: report.unitsUpdated,
      },
    });

    return report;
  }

  /**
   * Bulk import fleet equipment units from an Excel sheet.
   * Expected columns: [NO UNIT, CATEGORY, PLATE NUMBER, MAKE / MODEL, LAST KM, LAST HM]
   */
  static async importUnitsExcel(buffer: Buffer, currentUser: AuthenticatedUser) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('The uploaded workbook contains no readable worksheets.');
    }

    const report = {
      totalRowsScanned: 0,
      unitsCreated: 0,
      unitsUpdated: 0,
      skippedRows: 0,
      errors: [] as string[],
    };

    const rowsToProcess: {
      unitCode: string;
      category: UnitCategory;
      plateNumber?: string;
      makeModel?: string;
      lastKm: number;
      lastHm: number;
    }[] = [];

    worksheet.eachRow((row, rowNumber) => {
      // Skip header row
      if (rowNumber === 1) return;

      const values: any[] = row.values as any[];
      if (!values || values.length < 2) {
        report.skippedRows++;
        return;
      }

      // Column 1 = NO UNIT / UNIT CODE
      const rawUnitCode = String(values[1] || '').trim();
      const rawCategory = String(values[2] || '').trim().toUpperCase();
      const rawPlate = String(values[3] || '').trim();
      const rawModel = String(values[4] || '').trim();
      const rawKm = parseFloat(values[5]) || 0;
      const rawHm = parseFloat(values[6]) || 0;

      if (!BatchImportService.isValidUnitCode(rawUnitCode)) {
        report.skippedRows++;
        return;
      }

      report.totalRowsScanned++;

      const mappedCategory = this.unitCategoryMap[rawCategory] || UnitCategory.DUMP_TRUCK;

      rowsToProcess.push({
        unitCode: rawUnitCode,
        category: mappedCategory,
        plateNumber: rawPlate || undefined,
        makeModel: rawModel || undefined,
        lastKm: rawKm,
        lastHm: rawHm,
      });
    });

    for (const u of rowsToProcess) {
      try {
        const existing = await prisma.unit.findUnique({
          where: { unitCode: u.unitCode },
        });

        if (existing) {
          await prisma.unit.update({
            where: { id: existing.id },
            data: {
              category: u.category,
              plateNumber: u.plateNumber || existing.plateNumber,
              makeModel: u.makeModel || existing.makeModel,
              lastKm: u.lastKm > 0 ? u.lastKm : existing.lastKm,
              lastHm: u.lastHm > 0 ? u.lastHm : existing.lastHm,
              isActive: true,
            },
          });
          report.unitsUpdated++;
        } else {
          await prisma.unit.create({
            data: {
              unitCode: u.unitCode,
              category: u.category,
              plateNumber: u.plateNumber,
              makeModel: u.makeModel,
              lastKm: u.lastKm,
              lastHm: u.lastHm,
              isActive: true,
            },
          });
          report.unitsCreated++;
        }
      } catch (err: any) {
        report.errors.push(`Unit "${u.unitCode}": ${err.message}`);
      }
    }

    await AuditService.log({
      userId: currentUser.id,
      action: AuditAction.BATCH_IMPORT,
      entity: 'Unit',
      newValues: {
        scanned: report.totalRowsScanned,
        created: report.unitsCreated,
        updated: report.unitsUpdated,
      },
    });

    return report;
  }

  /**
   * Generates a pre-formatted Excel template for easy user data entry.
   */
  static generateTemplate(type: 'units' | 'fuel'): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Batara Fuel Monitoring System';

    if (type === 'units') {
      const sheet = workbook.addWorksheet('Fleet Units Template');
      sheet.columns = [
        { header: 'NO UNIT', key: 'unitCode', width: 16 },
        { header: 'CATEGORY', key: 'category', width: 22 },
        { header: 'PLATE NUMBER', key: 'plateNumber', width: 18 },
        { header: 'MAKE / MODEL', key: 'makeModel', width: 32 },
        { header: 'LAST KM', key: 'lastKm', width: 14 },
        { header: 'LAST HM', key: 'lastHm', width: 14 },
      ];

      // Header styling
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
      };

      // Add Sample Rows
      sheet.addRow({
        unitCode: 'DT-101',
        category: 'DUMP_TRUCK',
        plateNumber: 'KT 8192 BD',
        makeModel: 'Scania P460 CB 8x4 Heavy Tipper',
        lastKm: 42150.0,
        lastHm: 6320.5,
      });
      sheet.addRow({
        unitCode: 'EX-301',
        category: 'HEAVY_EQUIPMENT',
        plateNumber: 'HE-EX301',
        makeModel: 'Komatsu PC2000-8 Mining Shovel',
        lastKm: 1340.0,
        lastHm: 14280.0,
      });
      sheet.addRow({
        unitCode: 'GEN-01',
        category: 'GENERATOR',
        plateNumber: 'SITE-GEN01',
        makeModel: 'Perkins 500 kVA Primary Camp Genset',
        lastKm: 0.0,
        lastHm: 11400.0,
      });
      sheet.addRow({
        unitCode: 'LV-01',
        category: 'LIGHT_VEHICLE',
        plateNumber: 'KT 1104 DC',
        makeModel: 'Toyota Hilux 4x4 Site Patrol',
        lastKm: 85000.0,
        lastHm: 3140.0,
      });
    } else {
      const sheet = workbook.addWorksheet('Historical Fuel Logs Template');
      sheet.columns = [
        { header: 'NO', key: 'no', width: 8 },
        { header: 'NO UNIT', key: 'unitCode', width: 16 },
        { header: 'KATEGORI', key: 'category', width: 20 },
        { header: 'DATE', key: 'date', width: 15 },
        { header: 'JAM', key: 'jam', width: 12 },
        { header: 'HM', key: 'hm', width: 12 },
        { header: 'KM', key: 'km', width: 14 },
        { header: 'QTY OUT ( LITER )', key: 'qtyOut', width: 20 },
        { header: 'SHIFT', key: 'shift', width: 14 },
        { header: 'OPERATOR', key: 'operator', width: 24 },
        { header: 'FUEL IN', key: 'fuelIn', width: 14 },
        { header: 'TOTAL FUEL OUT', key: 'totalFuelOut', width: 18 },
        { header: 'STOCK AKHIR', key: 'stockAkhir', width: 16 },
        { header: 'TOTAL FUEL IN', key: 'totalFuelIn', width: 16 },
        { header: 'FUELMAN', key: 'fuelman', width: 20 },
      ];

      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };

      sheet.addRow({
        no: 1,
        unitCode: 'DT-101',
        category: 'DUMP TRUCK',
        date: '2026-08-01',
        jam: '07:30:00',
        hm: 6320.5,
        km: 42150.0,
        qtyOut: 450,
        shift: 'SHIFT 1',
        operator: 'Budi Santoso',
        fuelIn: 0,
        totalFuelOut: 450,
        stockAkhir: 44550,
        totalFuelIn: 0,
        fuelman: 'Admin System',
      });
    }

    return workbook;
  }
}

