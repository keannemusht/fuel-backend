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
    sheet.mergeCells('A1:O1');
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
    sheet.mergeCells('A2:O2');
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

    // 3. Table Column Headers (Row 4)
    const columns = [
      { header: 'NO', key: 'no', width: 8 },
      { header: 'NO UNIT', key: 'unitCode', width: 16 },
      { header: 'KATEGORI', key: 'category', width: 20 },
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

      const row = sheet.getRow(currentRowIdx);
      row.values = [
        log.no,
        log.unitCode,
        log.category,
        log.dateStr,
        log.jamStr,
        log.currentHm,
        log.currentKm,
        log.volumeLiters,
        log.shift,
        log.operator,
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
        if ([1, 4, 5, 9].includes(colNumber)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if ([6, 7, 8, 11, 12, 13, 14].includes(colNumber)) {
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

    sheet.mergeCells(`A${currentRowIdx}:G${currentRowIdx}`);
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
      if ([8, 11, 12, 13, 14].includes(colNumber)) {
        cell.numFmt = '#,##0.00';
      }
    });

    return workbook;
  }
}
