import { Response, NextFunction } from 'express';
import { ExcelService } from '../services/excel.service.js';
import { BatchImportService } from '../services/batchImport.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from '../services/audit.service.js';
import { AuditAction } from '@prisma/client';

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
}
