import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from './audit.service.js';
import { AuditAction } from '@prisma/client';
import { AuthenticatedUser } from '../types/index.js';

export interface CreateUnitDto {
  unitCode: string;
  plateNumber?: string;
  category?: string;
  type?: string;
  makeModel?: string;
  lastKm?: number;
  lastHm?: number;
}

export interface UpdateUnitDto {
  plateNumber?: string;
  category?: string;
  type?: string;
  makeModel?: string;
  lastKm?: number;
  lastHm?: number;
  isActive?: boolean;
}

export interface UnitFilterQuery {
  search?: string;
  category?: string;
  type?: string;
  isActive?: string;
}

export class UnitService {
  static async getUnits(query: UnitFilterQuery) {
    const { search, category, type, isActive } = query;
    const where: any = {};

    if (search) {
      where.OR = [
        { unitCode: { contains: search, mode: 'insensitive' } },
        { plateNumber: { contains: search, mode: 'insensitive' } },
        { makeModel: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { type: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category) {
      where.category = category;
    }

    if (type) {
      where.type = type;
    }

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    } else {
      where.isActive = true;
    }

    return prisma.unit.findMany({
      where,
      orderBy: { unitCode: 'asc' },
    });
  }

  static async getUnitById(id: string) {
    const unit = await prisma.unit.findUnique({
      where: { id },
    });

    if (!unit) {
      throw new AppError('Unit not found', 404);
    }

    return unit;
  }

  static async createUnit(
    dto: CreateUnitDto,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
    const existing = await prisma.unit.findUnique({
      where: { unitCode: dto.unitCode },
    });

    if (existing) {
      throw new AppError(`Unit with code ${dto.unitCode} already exists`, 409);
    }

    const unit = await prisma.unit.create({
      data: {
        unitCode: dto.unitCode.trim().toUpperCase(),
        plateNumber: dto.plateNumber?.trim(),
        category: dto.category || 'PRODUKSI',
        type: dto.type || (dto.unitCode.toUpperCase().startsWith('PM') ? 'DOUBLE_TRAILER' : 'DUMP_TRUCK'),
        makeModel: dto.makeModel?.trim(),
        lastKm: dto.lastKm || 0,
        lastHm: dto.lastHm || 0,
      },
    });

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.CREATE,
      entity: 'Unit',
      entityId: unit.id,
      newValues: unit,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return unit;
  }

  static async updateUnit(
    id: string,
    dto: UpdateUnitDto,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
    const oldUnit = await prisma.unit.findUnique({ where: { id } });
    if (!oldUnit) {
      throw new AppError('Unit not found', 404);
    }

    const updated = await prisma.unit.update({
      where: { id },
      data: {
        plateNumber: dto.plateNumber,
        category: dto.category !== undefined ? dto.category : oldUnit.category,
        type: dto.type !== undefined ? dto.type : (oldUnit as any).type,
        makeModel: dto.makeModel,
        lastKm: dto.lastKm !== undefined ? dto.lastKm : oldUnit.lastKm,
        lastHm: dto.lastHm !== undefined ? dto.lastHm : oldUnit.lastHm,
        isActive: dto.isActive !== undefined ? dto.isActive : oldUnit.isActive,
      },
    });

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.UPDATE,
      entity: 'Unit',
      entityId: updated.id,
      oldValues: oldUnit,
      newValues: updated,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return updated;
  }

  static async deleteUnit(
    id: string,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
    const unit = await prisma.unit.findUnique({
      where: { id },
      include: {
        _count: {
          select: { fuelLogs: true },
        },
      },
    });

    if (!unit) {
      throw new AppError('Fleet Unit not found', 404);
    }

    if (unit._count.fuelLogs > 0) {
      throw new AppError(
        `Cannot permanently delete unit "${unit.unitCode}" because it has ${unit._count.fuelLogs} associated fuel dispensing records. You can deactivate this unit instead to keep historical logs intact.`,
        409
      );
    }

    await prisma.unit.delete({ where: { id } });

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.DELETE,
      entity: 'Unit',
      entityId: unit.id,
      oldValues: unit,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { id, unitCode: unit.unitCode };
  }
}

