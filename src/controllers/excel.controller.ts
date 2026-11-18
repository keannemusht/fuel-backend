import { Response, NextFunction } from 'express';
import { ExcelService } from '../services/excel.service.js';
import { BatchImportService } from '../services/batchImport.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from '../services/audit.service.js';
import { AuditAction } from '@prisma/client';


const MONTH_NAMES_ERP = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

function formatErpTimeLabel(dateStr?: string, monthStr?: string): string {
  if (dateStr) return `DATE_${dateStr}`;
  if (monthStr) {
    const parts = monthStr.split('-');
    if (parts.length === 2) {
      const year = parts[0];
      const mIdx = parseInt(parts[1], 10) - 1;
      if (mIdx >= 0 && mIdx < 12) {
        return `${year}_${MONTH_NAMES_ERP[mIdx]}`;
      }
    }
    return `MONTH_${monthStr}`;
  }
  return 'ALL';
}

export class ExcelController {
  static async exportShiftExcel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { dateStr, monthStr, shift, unitCode } = req.query;
      const workbook = await ExcelService.generateShiftReport({
        dateStr: dateStr as string,
        monthStr: monthStr as string,
        shift: shift as string,
        unitCode: unitCode as string,
      });

      const label = dateStr ? `DATE_${dateStr}` : monthStr ? `MONTH_${monthStr}` : 'ALL';
      const fileName = `LOG_FUEL_MONITORING_${label}_${shift || 'ALL'}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      await workbook.xlsx.write(res);
      res.end();

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.EXPORT,
        entity: 'FuelLog',
        newValues: { fileName, filter: { dateStr, monthStr, shift, unitCode } },
        ipAddress: req.ip,
        userAgent,
      });

    } catch (error) {
      next(error);
    }
  }

  static async exportErpExcel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { dateStr, monthStr, site, format, scope } = req.query;

      if (format === 'csv') {
        return ExcelController.exportErpCsv(req, res, next);
      }

      const workbook = await ExcelService.generateErpReport({
        dateStr: dateStr as string,
        monthStr: monthStr as string,
        site: site as string,
        scope: scope as string,
      });

      const siteLabel = site === 'MUARA_PAHU' ? 'MUARAPAHU' : site === 'SENYIUR' ? 'SENYIUR' : 'ALL_SITE';
      const timeLabel = formatErpTimeLabel(dateStr as string, monthStr as string);
      const scopeSuffix = scope === 'other_consumption' || scope === 'other'
        ? '_OTHER_CONSUMPTION'
        : scope === 'all_registered' || scope === 'all'
        ? '_ALL_ERP'
        : '';
      const fileName = `UPLOAD_ERP_FUEL_${siteLabel}${scopeSuffix}_${timeLabel}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      await workbook.xlsx.write(res);
      res.end();

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.EXPORT,
        entity: 'FuelLog',
        newValues: { fileName, format: 'ERP_UPLOAD_15_COLS', filter: { dateStr, monthStr, site } },
        ipAddress: req.ip,
        userAgent,
      });
    } catch (error) {
      next(error);
    }
  }

  static async exportErpCsv(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { dateStr, monthStr, site, delimiter, header, scope } = req.query;
      const csvContent = await ExcelService.generateErpCsv({
        dateStr: dateStr as string,
        monthStr: monthStr as string,
        site: site as string,
        delimiter: delimiter as string,
        includeHeader: header === 'true',
        scope: scope as string,
      });

      const siteLabel = site === 'MUARA_PAHU' ? 'MUARAPAHU' : site === 'SENYIUR' ? 'SENYIUR' : 'ALL_SITE';
      const timeLabel = formatErpTimeLabel(dateStr as string, monthStr as string);
      const scopeSuffix = scope === 'other_consumption' || scope === 'other'
        ? '_OTHER_CONSUMPTION'
        : scope === 'all_registered' || scope === 'all'
        ? '_ALL_ERP'
        : '';
      const fileName = `UPLOAD_ERP_FUEL_${siteLabel}${scopeSuffix}_${timeLabel}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      res.status(200).send(csvContent);

      const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.EXPORT,
        entity: 'FuelLog',
        newValues: { fileName, format: 'ERP_UPLOAD_CSV_15_COLS', filter: { dateStr, monthStr, site } },
        ipAddress: req.ip,
        userAgent,
      });
    } catch (error) {
      next(error);
    }
  }

  static async batchImport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        throw new AppError('No Excel file uploaded. Please provide an .xlsx or .xls file.', 400);
      }

      const result = await BatchImportService.importLegacyExcel(req.file.buffer, req.user!, {
        defaultTankId: req.body.defaultTankId,
      });

      return sendSuccess(res, result, 'Excel batch import processed successfully');
    } catch (error) {
      next(error);
    }
  }

  static async importUnits(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        throw new AppError('No Excel file uploaded. Please provide an .xlsx or .xls file.', 400);
      }

      const result = await BatchImportService.importUnitsExcel(req.file.buffer, req.user!);
      return sendSuccess(res, result, 'Fleet units bulk imported successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getTemplate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const type = (req.query.type as 'units' | 'fuel') || 'units';
      const workbook = BatchImportService.generateTemplate(type);

      const fileName = type === 'units' ? 'TEMPLATE_FLEET_UNITS.xlsx' : 'TEMPLATE_HISTORICAL_FUEL_LOGS.xlsx';

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      next(error);
    }
  }
  static async getErpSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { dateStr, monthStr, site } = req.query;
      const summary = await ExcelService.getErpSummary({
        dateStr: dateStr as string,
        monthStr: monthStr as string,
        site: site as string,
      });
      return sendSuccess(res, summary, 'ERP summary retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}
