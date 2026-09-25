import { Response, NextFunction } from 'express';
import { GoogleSheetsService } from '../services/googleSheets.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { prisma } from '../config/prisma.js';
import { config } from '../config/env.js';

export class SyncController {
  static async triggerManualSync(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await GoogleSheetsService.processSyncQueue();
      return sendSuccess(res, result, 'Manual sync queue processing completed');
    } catch (error) {
      next(error);
    }
  }

  static async getSyncStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const [pendingCount, failedCount, syncedCount, lastLog] = await Promise.all([
        prisma.syncQueue.count({ where: { status: 'PENDING' } }),
        prisma.syncQueue.count({ where: { status: 'FAILED' } }),
        prisma.syncQueue.count({ where: { status: 'SYNCED' } }),
        prisma.fuelLog.findFirst({
          where: { syncStatus: 'SYNCED' },
          orderBy: { syncedAt: 'desc' },
          select: { syncedAt: true, logNumber: true },
        }),
      ]);

      const isConfigured = Boolean(
        config.googleSheets.serviceAccountEmail &&
        config.googleSheets.privateKey &&
        config.googleSheets.spreadsheetId
      );

      return sendSuccess(res, {
        isConfigured,
        spreadsheetId: config.googleSheets.spreadsheetId || null,
        sheetName: config.googleSheets.sheetName,
        spreadsheetUrl: config.googleSheets.spreadsheetId
          ? `https://docs.google.com/spreadsheets/d/${config.googleSheets.spreadsheetId}/edit`
          : null,
        pendingCount,
        failedCount,
        syncedCount,
        lastSyncedAt: lastLog?.syncedAt || null,
      }, 'Sync telemetry retrieved');
    } catch (error) {
      next(error);
    }
  }
}
