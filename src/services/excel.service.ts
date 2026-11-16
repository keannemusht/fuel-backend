import ExcelJS from 'exceljs';
import { prisma } from '../config/prisma.js';

export class ExcelService {
  /**
   * Generates a professionally styled ExcelJS workbook matching the 15 operational columns.
   */
  static async generateShiftReport(filter?: { dateStr?: string; monthStr?: string; shift?: string; unitCode?: string }) {
    const where: any = {};
    if (filter?.dateStr) {
      where.dateStr = filter.dateStr;
    } else if (filter?.monthStr) {
      where.dateStr = { startsWith: filter.monthStr };
    }
    if (filter?.shift) where.shift = filter.shift;
    if (filter?.unitCode) where.unitCode = { contains: filter.unitCode, mode: 'insensitive' };

    const logs = await prisma.fuelLog.findMany({
      where,
      include: {
        unit: {
          select: {
            hasHm: true,
            hasKm: true,
            hasKwh: true,
          },
        },
      },
      orderBy: [{ no: 'asc' }],
    });


    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Batara Fuel Monitoring System (FMS-Core)';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('LOG FUEL MONITORING', {
      views: [{ showGridLines: true, state: 'frozen', ySplit: 5 }],
      pageSetup: { orientation: 'landscape', paperSize: 9 },
    });

    // 1. Title Banner
    sheet.mergeCells('A1:P1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'BATARA INDUSTRIAL FUEL DISPENSING & MONITORING REPORT';
    titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' }, // Slate-900
    };
    sheet.getRow(1).height = 30;

    // 2. Subtitle / Filter Info
    sheet.mergeCells('A2:P2');
    const subCell = sheet.getCell('A2');
    subCell.value = `FILTER: DATE = ${filter?.dateStr || 'ALL'} | SHIFT = ${filter?.shift || 'ALL'} | EXPORTED AT: ${new Date().toLocaleString()}`;
    subCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FFCBD5E1' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
    subCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' }, // Slate-800
    };
    sheet.getRow(2).height = 20;

    sheet.addRow([]); // Blank line at row 3

    // 3. Table Column Headers (Row 4) - 16 Columns
    const columns = [
      { header: 'NO', key: 'no', width: 8 },
      { header: 'NO UNIT', key: 'unitCode', width: 16 },
      { header: 'KATEGORI', key: 'category', width: 20 },
      { header: 'TYPE', key: 'type', width: 18 },
      { header: 'DATE', key: 'dateStr', width: 14 },
      { header: 'JAM', key: 'jamStr', width: 12 },
      { header: 'HM', key: 'currentHm', width: 14 },
      { header: 'KM', key: 'currentKm', width: 14 },
      { header: 'QTY OUT ( LITER )', key: 'volumeLiters', width: 22 },
      { header: 'SHIFT', key: 'shift', width: 14 },
      { header: 'OPERATOR', key: 'operator', width: 22 },
      { header: 'FUEL IN', key: 'fuelInLiters', width: 16 },
      { header: 'TOTAL FUEL OUT', key: 'totalFuelOut', width: 20 },
      { header: 'STOCK AKHIR', key: 'stockAkhir', width: 18 },
      { header: 'TOTAL FUEL IN', key: 'totalFuelIn', width: 18 },
      { header: 'FUELMAN', key: 'fuelmanName', width: 20 },
    ];

    sheet.columns = columns;

    const headerRow = sheet.getRow(4);
    headerRow.values = columns.map((c) => c.header);
    headerRow.height = 28;

    headerRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD97706' }, // Industrial Amber-600
      };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });

    // 4. Data Rows
    let currentRowIdx = 5;
    let totalQtyOut = 0;
    let totalFuelIn = 0;

    for (const log of logs) {
      totalQtyOut += log.volumeLiters;
      totalFuelIn += log.fuelInLiters;

      const hasHm = log.unit ? log.unit.hasHm : log.currentHm > 0;
      const hasKm = log.unit ? log.unit.hasKm : log.currentKm > 0;
      const displayHm = hasHm ? log.currentHm : '-';
      const displayKm = hasKm ? log.currentKm : '-';
      const hasKwh = log.unit ? log.unit.hasKwh : (log.currentKwh && log.currentKwh > 0);
      const displayOperator = hasKwh && log.currentKwh && log.currentKwh > 0 && !log.operator.includes('Kwh')
        ? `${log.operator} (${log.currentKwh} Kwh)`
        : log.operator;

      const row = sheet.getRow(currentRowIdx);
      row.values = [
        log.no,
        log.unitCode,
        log.category,
        (log as any).type || '-',
        log.dateStr,
        log.jamStr,
        displayHm,
        displayKm,
        log.volumeLiters,
        log.shift,
        displayOperator,
        log.fuelInLiters,
        log.totalFuelOut,
        log.stockAkhir,
        log.totalFuelIn,
        log.fuelmanName,
      ];
      row.height = 22;

      // Formatting & Zebra striping
      const isEven = currentRowIdx % 2 === 0;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };

        if (isEven) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        }

        // Alignments & Number formatting
        // Center: 1 (NO), 5 (DATE), 6 (JAM), 10 (SHIFT)
        if ([1, 5, 6, 10].includes(colNumber)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if ([7, 8].includes(colNumber)) {
          // HM and KM: if '-' center it, else right numeric
          if (cell.value === '-') {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          } else {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.numFmt = '#,##0.00';
          }
        } else if ([9, 12, 13, 14, 15].includes(colNumber)) {
          // Right & numeric: 9 (QTY OUT), 12 (FUEL IN), 13 (TOTAL FUEL OUT), 14 (STOCK AKHIR), 15 (TOTAL FUEL IN)
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.00';
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      });

      currentRowIdx++;
    }

    // 5. Grand Summary Row
    const summaryRow = sheet.getRow(currentRowIdx);
    summaryRow.values = [
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      totalQtyOut,
      '',
      '',
      totalFuelIn,
      logs.length > 0 ? logs[logs.length - 1].totalFuelOut : 0,
      logs.length > 0 ? logs[logs.length - 1].stockAkhir : 0,
      logs.length > 0 ? logs[logs.length - 1].totalFuelIn : 0,
      '',
    ];
    summaryRow.height = 26;

    sheet.mergeCells(`A${currentRowIdx}:H${currentRowIdx}`);
    const sumTotalLabel = sheet.getCell(`A${currentRowIdx}`);
    sumTotalLabel.value = 'TOTAL REKAPITULASI';
    sumTotalLabel.alignment = { vertical: 'middle', horizontal: 'center' };

    summaryRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' }, // Slate-800
      };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF000000' } },
        bottom: { style: 'double', color: { argb: 'FF000000' } },
      };
      if ([9, 12, 13, 14, 15].includes(colNumber)) {
        cell.numFmt = '#,##0.00';
      }
    });

    return workbook;
  }

  /**
   * Resolves official ERP Storage Location code based on company SAP/ERP master data:
   * - MAINTANK SENYIUR 01 -> MTK004
   * - FUEL TRUCK 001 (FT 101 / FT 102) -> FT001
   * - MAINTANK MUARA PAHU 01 -> MTK003
   */
  private static resolveErpSloc(log: any, defaultSite?: string): string {
    const tank = log.tank;
    const tankCode = (tank?.tankCode || '').toUpperCase();
    const tankName = (tank?.name || '').toUpperCase();
    const rawSloc = (log.slocCode || tank?.slocCode || '').toUpperCase().trim();
    const site = (log.site || tank?.site || defaultSite || 'SENYIUR').toUpperCase();

    // 1. Direct match with official ERP Sloc Codes (Storage Location SNY.xls & MP.xls)
    if (rawSloc === 'MTK004') return 'MTK004';
    if (rawSloc === 'MTK003') return 'MTK003';
    if (rawSloc === 'FT001') return 'FT001';

    // 2. Legacy MTK001 -> Official MTK004 (MAINTANK SENYIUR 01)
    if (rawSloc === 'MTK001') return 'MTK004';

    // 3. Legacy FTK001 / FTK002 -> Official FT001 (FUEL TRUCK 001)
    if (rawSloc === 'FTK001' || rawSloc === 'FTK002') return 'FT001';

    // 4. Tank Type / Name mapping
    if (
      tankCode.includes('FT_') ||
      tankName.includes('FUEL TRUCK') ||
      tankName.includes('FT 101') ||
      tankName.includes('FT 102') ||
      tank?.tankType === 'MOBILE_TRUCK' ||
      log.sourceType === 'FUEL_TRUCK'
    ) {
      return 'FT001';
    }

    if (site === 'MUARA_PAHU' || tankCode.includes('MUARA') || tankName.includes('MUARA')) {
      return 'MTK003';
    }

    // Default for Senyiur Main Tank
    return 'MTK004';
  }

  /**
   * Formats numbers cleanly for ERP import (integer if whole, e.g. 200, 180, 30, 20, 1)
   */
  private static formatErpNumber(val: number | null | undefined): string {
    if (val === null || val === undefined || isNaN(val)) return '0';
    const num = Number(val);
    if (Number.isInteger(num) || num % 1 === 0) {
      return Math.round(num).toString();
    }
    return parseFloat(num.toFixed(2)).toString();
  }

  /**
   * Generates exact ERP CSV format matching UPLOAD_ERP_FUEL_SENYIUR_2026_11_TEST.csv
   * Specification:
   * - 15 Columns: Unit Code, Code Alias, Shift D/N*, Date YYYYMMDD*, Time HH:MM*, Opr/Drv*, Fuelman*, Broken 0/2*, Code Storage Loc., Hm/Km Current*, Hm/Km Last*, Material Code*, End Flow *, Start Flow *, Qty*
   * - Default NO header row, pure CSV rows matching ERP upload specification
   * - NO BOM, CRLF (\r\n) line endings
   * - Clean unit codes without spaces (e.g. LV502, PM422)
   * - Storage Location: MTK004 (Senyiur Main), FT001 (Fuel Truck), MTK003 (Muara Pahu)
   * - Material Code: FL-01-0001 (BIO SOLAR B-0)
   */
  static async generateErpCsv(filter?: {
    dateStr?: string;
    monthStr?: string;
    site?: string;
    delimiter?: string;
    includeHeader?: boolean;
  }): Promise<string> {
    const where: any = {};
    if (filter?.dateStr) {
      where.dateStr = filter.dateStr;
    } else if (filter?.monthStr) {
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
            plateNumber: true,
            hasHm: true,
            hasKm: true,
            hasKwh: true,
          },
        },
        tank: {
          select: {
            tankCode: true,
            name: true,
            site: true,
            slocCode: true,
            projectArea: true,
            tankType: true,
          },
        },
      },
      orderBy: [{ dateStr: 'asc' }, { jamStr: 'asc' }, { no: 'asc' }],
    });

    const sep = filter?.delimiter === 'semicolon' || filter?.delimiter === ';' ? ';' : ',';

    const escapeCsv = (val: any): string => {
      if (val === null || val === undefined) return '';
      const str = String(val).trim();
      if (str.includes(sep) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows: string[] = [];

    if (filter?.includeHeader) {
      const headers = [
        'Unit Code',
        'Code Alias',
        'Shift D/N*',
        'Date YYYYMMDD*',
        'Time HH:MM*',
        'Opr/Drv*',
        'Fuelman*',
        'Broken 0/2*',
        'Code Storage Loc.',
        'Hm/Km Current*',
        'Hm/Km Last*',
        'Material Code*',
        'End Flow *',
        'Start Flow *',
        'Qty*',
      ];
      rows.push(headers.map(escapeCsv).join(sep));
    }

    logs.forEach((log) => {
      // 1. Clean Unit Code & Alias (stripping whitespace e.g. "LV 502" -> "LV502")
      const cleanUnitCode = log.unitCode ? log.unitCode.replace(/\s+/g, '') : '';
      const alias = log.unit?.plateNumber ? log.unit.plateNumber.replace(/\s+/g, '') : cleanUnitCode;

      // 2. Shift (D / N)
      const shiftCode = log.shift === 'SHIFT 2' || log.shift === '2' || log.shift?.toLowerCase().includes('night') ? 'N' : 'D';

      // 3. Date (YYYYMMDD) & Time (HH:MM)
      const dateFormatted = log.dateStr ? log.dateStr.replace(/[^0-9]/g, '') : '';
      const timeFormatted = log.jamStr ? log.jamStr.substring(0, 5) : '00:00';

      // 4. Operator & Fuelman
      const operator = (log.operator && log.operator.trim()) ? log.operator.trim() : 'Admin';
      const fuelman = (log.fuelmanName && log.fuelmanName.trim()) ? log.fuelmanName.trim() : 'Admin';

      // 5. Broken (0 = Normal, 2 = Bypass/Broken)
      const isBroken = log.bypassValidation ? '2' : '0';

      // 6. Code Storage Loc. (MTK004 / FT001 / MTK003)
      const sloc = ExcelService.resolveErpSloc(log, filter?.site);

      // 7. Meter Current & Last
      const currentMeter = log.currentHm > 0 ? log.currentHm : (log.currentKm > 0 ? log.currentKm : (log.currentKwh > 0 ? log.currentKwh : 0));
      const lastMeter = log.previousHm > 0 ? log.previousHm : (log.previousKm > 0 ? log.previousKm : (log.previousKwh > 0 ? log.previousKwh : 0));

      // 8. Material Code (FL-01-0001 for BIO SOLAR B-0)
      const materialCode = 'FL-01-0001';

      // 9. Flow & Qty
      const endFlow = log.flowAkhir !== null && log.flowAkhir !== undefined && log.flowAkhir > 0
        ? log.flowAkhir
        : (log.volumeLiters > 0 ? log.volumeLiters : 0);
      const startFlow = log.flowAwal !== null && log.flowAwal !== undefined ? log.flowAwal : 0;
      const qty = log.volumeLiters;

      const rowValues = [
        cleanUnitCode,
        alias,
        shiftCode,
        dateFormatted,
        timeFormatted,
        operator,
        fuelman,
        isBroken,
        sloc,
        ExcelService.formatErpNumber(currentMeter),
        ExcelService.formatErpNumber(lastMeter),
        materialCode,
        ExcelService.formatErpNumber(endFlow),
        ExcelService.formatErpNumber(startFlow),
        ExcelService.formatErpNumber(qty),
      ];

      rows.push(rowValues.map(escapeCsv).join(sep));
    });

    // Pure CRLF line endings without UTF-8 BOM, matching UPLOAD_ERP_FUEL_SENYIUR_2026_11_TEST.csv
    return rows.join('\r\n') + (rows.length > 0 ? '\r\n' : '');
  }

  /**
   * Generates exact ERP format matching "Format Upload Fuel.xls" / "Format Upload & Sloc.Fuel.xls"
   */
  static async generateErpReport(filter?: { dateStr?: string; monthStr?: string; site?: string }) {
    const where: any = {};
    if (filter?.dateStr) {
      where.dateStr = filter.dateStr;
    } else if (filter?.monthStr) {
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
            plateNumber: true,
            hasHm: true,
            hasKm: true,
            hasKwh: true,
          },
        },
        tank: {
          select: {
            tankCode: true,
            name: true,
            site: true,
            slocCode: true,
            projectArea: true,
            tankType: true,
          },
        },
      },
      orderBy: [{ dateStr: 'asc' }, { jamStr: 'asc' }, { no: 'asc' }],
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Batara Fuel Monitoring System (FMS-Core)';
    workbook.created = new Date();

    // Sheet 1: Format upload Fuel
    const sheet = workbook.addWorksheet('Format upload Fuel', {
      views: [{ showGridLines: true, state: 'frozen', ySplit: 1 }],
    });

    const headers = [
      'Unit Code',
      'Code Alias',
      'Shift\nD/N*',
      'Date\nYYYYMMDD*',
      'Time\nHH:MM*',
      'Opr/Drv*\n',
      'Fuelman*\n',
      'Broken\n0/2*',
      'Code\nStorage Loc.',
      'Hm/Km\nCurrent*',
      'Hm/Km\nLast*',
      'Material Code*',
      'End Flow *',
      'Start Flow *',
      'Qty*',
    ];

    sheet.columns = [
      { key: 'unitCode', width: 14 },
      { key: 'codeAlias', width: 14 },
      { key: 'shift', width: 10 },
      { key: 'date', width: 16 },
      { key: 'time', width: 12 },
      { key: 'operator', width: 20 },
      { key: 'fuelman', width: 20 },
      { key: 'broken', width: 12 },
      { key: 'sloc', width: 18 },
      { key: 'currentMeter', width: 16 },
      { key: 'lastMeter', width: 16 },
      { key: 'materialCode', width: 16 },
      { key: 'endFlow', width: 14 },
      { key: 'startFlow', width: 14 },
      { key: 'qty', width: 14 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.values = headers;
    headerRow.height = 32;

    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });

    logs.forEach((log) => {
      const cleanUnitCode = log.unitCode ? log.unitCode.replace(/\s+/g, '') : '';
      const alias = log.unit?.plateNumber ? log.unit.plateNumber.replace(/\s+/g, '') : cleanUnitCode;
      const shiftCode = log.shift === 'SHIFT 2' || log.shift === '2' || log.shift?.toLowerCase().includes('night') ? 'N' : 'D';
      const dateFormatted = log.dateStr ? log.dateStr.replace(/[^0-9]/g, '') : '';
      const timeFormatted = log.jamStr ? log.jamStr.substring(0, 5) : '00:00';
      const operator = (log.operator && log.operator.trim()) ? log.operator.trim() : 'Admin';
      const fuelman = (log.fuelmanName && log.fuelmanName.trim()) ? log.fuelmanName.trim() : 'Admin';
      const isBroken = log.bypassValidation ? '2' : '0';
      const sloc = ExcelService.resolveErpSloc(log, filter?.site);
      const currentMeter = log.currentHm > 0 ? log.currentHm : (log.currentKm > 0 ? log.currentKm : (log.currentKwh > 0 ? log.currentKwh : 0));
      const lastMeter = log.previousHm > 0 ? log.previousHm : (log.previousKm > 0 ? log.previousKm : (log.previousKwh > 0 ? log.previousKwh : 0));
      const materialCode = 'FL-01-0001';
      const endFlow = log.flowAkhir !== null && log.flowAkhir !== undefined && log.flowAkhir > 0
        ? log.flowAkhir
        : (log.volumeLiters > 0 ? log.volumeLiters : 0);
      const startFlow = log.flowAwal !== null && log.flowAwal !== undefined ? log.flowAwal : 0;
      const qty = log.volumeLiters;

      const row = sheet.addRow([
        cleanUnitCode,
        alias,
        shiftCode,
        dateFormatted,
        timeFormatted,
        operator,
        fuelman,
        isBroken,
        sloc,
        Number(ExcelService.formatErpNumber(currentMeter)),
        Number(ExcelService.formatErpNumber(lastMeter)),
        materialCode,
        Number(ExcelService.formatErpNumber(endFlow)),
        Number(ExcelService.formatErpNumber(startFlow)),
        Number(ExcelService.formatErpNumber(qty)),
      ]);

      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
        if ([3, 4, 5, 8, 9, 12].includes(colNumber)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if ([10, 11, 13, 14, 15].includes(colNumber)) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.0';
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      });
    });

    // Sheet 2: Master Warehouse (Reference Sheet matching Format Upload & Sloc.Fuel.xls)
    const whSheet = workbook.addWorksheet('Master Warehouse');
    whSheet.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Storage Location', key: 'name', width: 28 },
      { header: 'Material Code', key: 'mat', width: 16 },
      { header: 'Specification', key: 'spec', width: 18 },
      { header: 'Project Area', key: 'area', width: 14 },
      { header: 'Stmain', key: 'stmain', width: 10 },
      { header: 'Material Category', key: 'cat', width: 18 },
    ];
    whSheet.getRow(1).font = { name: 'Calibri', size: 10, bold: true };

    const warehouseMaster = [
      { code: 'MTK004', name: 'MAINTANK SENYIUR 01', area: 'SNY' },
      { code: 'FT001', name: 'FUEL TRUCK 001', area: 'SNY' },
      { code: 'MTK003', name: 'MAINTANK MUARA PAHU 01', area: 'MPH' },
    ];

    warehouseMaster.forEach((item, idx) => {
      whSheet.addRow([
        idx + 1,
        item.code,
        item.name,
        'FL-01-0001',
        'BIO SOLAR B-0',
        item.area,
        0,
        'V001',
      ]);
    });

    return workbook;
  }
}
