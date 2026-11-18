import { Response, NextFunction } from 'express';
import { ReconciliationService } from '../services/reconciliation.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { prisma } from '../config/prisma.js';

export class ReconciliationController {
  /**
   * GET /api/reconciliation/health?monthStr=2026-08&site=SENYIUR
   * Returns health score, summary stats, and categorized anomaly list
   */
  static async getHealth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { monthStr, site, lang } = req.query;
      const result = await ReconciliationService.auditMonth({
        monthStr: monthStr as string,
        site: site as string,
        lang: (lang as string) || 'id',
      });

      return sendSuccess(res, result, 'Audit integritas data berhasil.');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/reconciliation/apply
   * Applies approved reconciliation fixes with audit trail
   */
  static async applyFixes(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { fixes } = req.body;
      if (!fixes || !Array.isArray(fixes) || fixes.length === 0) {
        throw new AppError('Array fixes diperlukan dan tidak boleh kosong.', 400);
      }

      const result = await ReconciliationService.applyFixes({
        fixes,
        userId: req.user?.id,
        userIp: req.ip,
      });

      return sendSuccess(res, result, result.message);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/reconciliation/rollback
   * Reverts reconciliation fixes to their pre-reconciled values
   */
  static async rollback(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { auditBatchId, logIds } = req.body;
      const result = await ReconciliationService.rollbackBatch({
        auditBatchId,
        logIds,
        userId: req.user?.id,
      });

      return sendSuccess(res, result, result.message);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/reconciliation/history
   * Lists reconciliation history for audit and rollback verification
   */
  static async getHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const limit = parseInt((req.query.limit as string) || '50', 10);
      const audits = await prisma.auditLog.findMany({
        where: { entity: 'FuelLog_Reconciliation' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          user: {
            select: {
              fullName: true,
              username: true,
              role: true,
            },
          },
        },
      });

      return sendSuccess(res, audits, 'Riwayat rekonsiliasi berhasil diambil.');
    } catch (err) {
      next(err);
    }
  }
}
