import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from './audit.service.js';
import { AuditAction, Role } from '@prisma/client';
import { AuthenticatedUser } from '../types/index.js';

export interface CreateUserDto {
  username: string;
  email: string;
  password: string;
  fullName: string;
  role?: Role;
  isActive?: boolean;
}

export interface UpdateUserDto {
  fullName?: string;
  email?: string;
  role?: Role;
  isActive?: boolean;
  password?: string;
}

export interface UserFilterQuery {
  search?: string;
  role?: string;
  isActive?: string;
}

export class UserService {
  static async getUsers(query: UserFilterQuery) {
    const { search, role, isActive } = query;
    const where: any = {};

    if (search) {
      const searchStr = String(search).trim();
      where.OR = [
        { username: { contains: searchStr, mode: 'insensitive' } },
        { email: { contains: searchStr, mode: 'insensitive' } },
        { fullName: { contains: searchStr, mode: 'insensitive' } },
      ];
    }

    if (role && (role === 'ADMIN' || role === 'FUELMAN' || role === 'MANAGEMENT')) {
      where.role = role as Role;
    }

    if (isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true';
    }

    return prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            fuelLogs: true,
            auditLogs: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getUserById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            fuelLogs: true,
            auditLogs: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return user;
  }

  static async createUser(
    dto: CreateUserDto,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
    const username = dto.username.trim();
    const email = dto.email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: username, mode: 'insensitive' } },
          { email: { equals: email, mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      if (existing.username.toLowerCase() === username.toLowerCase()) {
        throw new AppError(`Username '${username}' is already in use.`, 409);
      }
      throw new AppError(`Email '${email}' is already registered.`, 409);
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const newUser = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        role: dto.role || Role.FUELMAN,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.CREATE,
      entity: 'User',
      entityId: newUser.id,
      newValues: {
        username: newUser.username,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        isActive: newUser.isActive,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return newUser;
  }

  static async updateUser(
    id: string,
    dto: UpdateUserDto,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new AppError('User not found', 404);
    }

    if (currentUser?.id === id) {
      if (dto.isActive === false) {
        throw new AppError('You cannot deactivate your own active account.', 400);
      }
      if (dto.role && dto.role !== Role.ADMIN) {
        throw new AppError('You cannot demote your own account from the ADMIN role.', 400);
      }
    }

    if (dto.email && dto.email.toLowerCase() !== existingUser.email.toLowerCase()) {
      const conflict = await prisma.user.findFirst({
        where: {
          email: { equals: dto.email, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (conflict) {
        throw new AppError(`Email '${dto.email}' is already taken by another account.`, 409);
      }
    }

    const updateData: any = {};
    if (dto.fullName !== undefined) updateData.fullName = dto.fullName.trim();
    if (dto.email !== undefined) updateData.email = dto.email.trim().toLowerCase();
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.password && dto.password.trim().length > 0) {
      updateData.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: updatedUser.id,
      oldValues: {
        fullName: existingUser.fullName,
        email: existingUser.email,
        role: existingUser.role,
        isActive: existingUser.isActive,
      },
      newValues: {
        fullName: updatedUser.fullName,
        email: updatedUser.email,
        role: updatedUser.role,
        isActive: updatedUser.isActive,
        passwordUpdated: Boolean(dto.password && dto.password.trim().length > 0),
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return updatedUser;
  }

  static async deleteUser(
    id: string,
    currentUser?: AuthenticatedUser,
    meta?: { ipAddress?: string; userAgent?: string }
  ) {
    if (currentUser?.id === id) {
      throw new AppError('You cannot delete your own account.', 400);
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            fuelLogs: true,
            auditLogs: true,
          },
        },
      },
    });

    if (!targetUser) {
      throw new AppError('User not found', 404);
    }

    if (targetUser._count.fuelLogs > 0) {
      throw new AppError(
        `Cannot permanently delete user '${targetUser.fullName}' because they have recorded ${targetUser._count.fuelLogs} fuel dispensing transaction(s). Deactivate this user instead to block their system access while preserving historical telemetry.`,
        400
      );
    }

    if (targetUser._count.auditLogs > 0) {
      await prisma.auditLog.updateMany({
        where: { userId: id },
        data: { userId: null },
      });
    }

    await prisma.user.delete({
      where: { id },
    });

    await AuditService.log({
      userId: currentUser?.id,
      action: AuditAction.DELETE,
      entity: 'User',
      entityId: id,
      oldValues: {
        username: targetUser.username,
        email: targetUser.email,
        fullName: targetUser.fullName,
        role: targetUser.role,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { id, username: targetUser.username };
  }
}

