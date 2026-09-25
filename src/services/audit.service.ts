import { prisma } from '../config/prisma.js';
import { AuditAction } from '@prisma/client';
import { logger } from '../utils/logger.js';

export interface CreateAuditLogParams {
  userId?: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  oldValues?: any;
  newValues?: any;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  static async log(params: CreateAuditLogParams) {
    try {
      return await prisma.auditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId,
          oldValues: params.oldValues ? JSON.stringify(params.oldValues) : null,
          newValues: params.newValues ? JSON.stringify(params.newValues) : null,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      });
    } catch (error) {
      logger.error('Failed to write immutable audit log:', error);
      // Audit failure shouldn't crash non-critical workflows, but is heavily logged
    }
  }

  static async getLogs(query: {
    page?: number;
    limit?: number;
    entity?: string;
    action?: AuditAction;
    userId?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.entity) where.entity = query.entity;
    if (query.action) where.action = query.action;
    if (query.userId) where.userId = query.userId;

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getLogById(id: string) {
    return await prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            role: true,
          },
        },
      },
    });
  }

  static async createManualLog(params: {
    userId?: string;
    action: AuditAction;
    entity: string;
    entityId?: string;
    reason?: string;
    newValues?: any;
    ipAddress?: string;
    userAgent?: string;
  }) {
    let payload = params.newValues;
    if (params.reason && typeof payload === 'object' && payload !== null) {
      payload = { ...payload, reason: params.reason };
    } else if (params.reason && !payload) {
      payload = { reason: params.reason };
    }

    return await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        newValues: payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : null,
        ipAddress: params.ipAddress || '127.0.0.1',
        userAgent: params.userAgent,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            role: true,
          },
        },
      },
    });
  }

  static async updateLog(id: string, params: {
    reason?: string;
    notes?: string;
    newValues?: any;
  }) {
    const existing = await prisma.auditLog.findUnique({ where: { id } });
    if (!existing) return null;

    let updatedNewValues = existing.newValues;
    try {
      const parsed = existing.newValues ? JSON.parse(existing.newValues) : {};
      if (params.reason !== undefined) parsed.reason = params.reason;
      if (params.notes !== undefined) parsed.notes = params.notes;
      updatedNewValues = JSON.stringify(parsed);
    } catch {
      if (params.reason) updatedNewValues = JSON.stringify({ reason: params.reason, raw: existing.newValues });
    }

    return await prisma.auditLog.update({
      where: { id },
      data: {
        newValues: updatedNewValues,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            role: true,
          },
        },
      },
    });
  }

  static async deleteLog(id: string) {
    return await prisma.auditLog.delete({
      where: { id },
    });
  }

  static async clearLogs() {
    return await prisma.auditLog.deleteMany({});
  }
}
