import { Response, NextFunction } from 'express';
import { FuelService } from '../services/fuel.service.js';
import { GoogleSheetsService } from '../services/googleSheets.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { SyncStatus } from '@prisma/client';

export class FuelController {
  static async recordDispense(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await FuelService.recordDispense(req.body, req.user!, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return sendSuccess(res, result, 'Fuel dispense recorded successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async getMeterContext(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { unitId, dateStr, jamStr } = req.query;
      const context = await FuelService.getMeterContext(
        unitId as string,
        dateStr as string,
        jamStr as string | undefined
      );
      return sendSuccess(res, context, 'Meter chronological context retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async recordBackdate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await FuelService.recordBackdateDispense(req.body, req.user!, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return sendSuccess(res, result, 'Backdated fuel transaction recorded successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async getFuelLogs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page, limit, unitCode, dateStr, monthStr, shift, fuelmanId, syncStatus } = req.query;
      const result = await FuelService.getFuelLogs({
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        unitCode: unitCode as string,
        dateStr: dateStr as string,
        monthStr: monthStr as string,
        shift: shift as string,
        fuelmanId: req.user?.role === 'FUELMAN' ? req.user.id : (fuelmanId as string),
        syncStatus: syncStatus as SyncStatus,
      });
      return sendSuccess(res, result.data, 'Fuel logs retrieved successfully', 200, result.meta);
    } catch (error) {
      next(error);
    }
  }

  static async getShiftSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { dateStr, shift } = req.query;
      const summary = await FuelService.getShiftSummary(dateStr as string, shift as string);
      return sendSuccess(res, summary, 'Shift summary retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getMonthlySummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const now = new Date();
      const year = req.query.year ? parseInt(req.query.year as string, 10) : now.getFullYear();
      const month = req.query.month ? parseInt(req.query.month as string, 10) : (now.getMonth() + 1);

      const summary = await FuelService.getMonthlySummary(year, month);
      return sendSuccess(res, summary, 'Monthly fuel summary retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async syncMonthlyRecords(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { monthStr } = req.body;
      if (!monthStr || !monthStr.includes('-')) {
        throw new AppError('A valid month string (YYYY-MM) is required for synchronization.', 422);
      }

      const result = await GoogleSheetsService.syncMonthToSheets(monthStr);
      return sendSuccess(res, result, `Successfully synchronized month ${monthStr} to Google Sheets tab "${result.targetSheet}"`);
    } catch (error) {
      next(error);
    }
  }

  static async syncMasterSheet(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await GoogleSheetsService.syncMasterSheet();
      return sendSuccess(res, result, `Successfully synchronized all records to master Google Sheets tab "${result.targetSheet}"`);
    } catch (error) {
      next(error);
    }
  }

  static async createHistoricalLog(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const log = await FuelService.createHistoricalLog(req.body, req.user!);
      return sendSuccess(res, log, 'Historical fuel record created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateHistoricalLog(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const log = await FuelService.updateHistoricalLog(id, req.body, req.user!);
      return sendSuccess(res, log, 'Historical fuel record updated successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  static async deleteHistoricalLog(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await FuelService.deleteHistoricalLog(id, req.user!);
      return sendSuccess(res, result, 'Historical fuel record deleted successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  static async getOperators(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const operators = await FuelService.getDistinctOperators();
      return sendSuccess(res, operators, 'Operators retrieved successfully', 200);
    } catch (error) {
      next(error);
    }
  }
}
