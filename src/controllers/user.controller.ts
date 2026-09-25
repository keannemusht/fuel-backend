import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from '../services/audit.service.js';
import { AuditAction, Role } from '@prisma/client';

export class UserController {
  static async getUsers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { search, role, isActive } = req.query;
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
        where.role = role as any;
      }

      if (isActive !== undefined && isActive !== '') {
        where.isActive = isActive === 'true';
      }

      const users = await prisma.user.findMany({
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

      return sendSuccess(res, users, 'Users retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getUserById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
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

      return sendSuccess(res, user, 'User retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async createUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { username, email, password, fullName, role, isActive } = req.body;

      // Check unique constraints
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

      const passwordHash = await bcrypt.hash(password, 10);
      const newUser = await prisma.user.create({
        data: {
          username: username.trim(),
          email: email.trim().toLowerCase(),
          passwordHash,
          fullName: fullName.trim(),
          role: role || Role.FUELMAN,
          isActive: isActive !== undefined ? isActive : true,
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

      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      await AuditService.log({
        userId: req.user?.id,
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
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, newUser, 'User created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { fullName, email, role, isActive, password } = req.body;

      const existingUser = await prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        throw new AppError('User not found', 404);
      }

      // Self-protection guard for current admin
      if (req.user?.id === id) {
        if (isActive === false) {
          throw new AppError('You cannot deactivate your own active account.', 400);
        }
        if (role && role !== Role.ADMIN) {
          throw new AppError('You cannot demote your own account from the ADMIN role.', 400);
        }
      }

      // Check unique email conflict if changing
      if (email && email.toLowerCase() !== existingUser.email.toLowerCase()) {
        const conflict = await prisma.user.findFirst({
          where: {
            email: { equals: email, mode: 'insensitive' },
            id: { not: id },
          },
        });
        if (conflict) {
          throw new AppError(`Email '${email}' is already taken by another account.`, 409);
        }
      }

      const updateData: any = {};
      if (fullName !== undefined) updateData.fullName = fullName.trim();
      if (email !== undefined) updateData.email = email.trim().toLowerCase();
      if (role !== undefined) updateData.role = role;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (password && password.trim().length > 0) {
        updateData.passwordHash = await bcrypt.hash(password, 10);
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

      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      await AuditService.log({
        userId: req.user?.id,
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
          passwordUpdated: Boolean(password && password.trim().length > 0),
        },
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, updatedUser, 'User updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      if (req.user?.id === id) {
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

      // Check operational fuel logs constraint
      if (targetUser._count.fuelLogs > 0) {
        throw new AppError(
          `Cannot permanently delete user '${targetUser.fullName}' because they have recorded ${targetUser._count.fuelLogs} fuel dispensing transaction(s). Deactivate this user instead to block their system access while preserving historical telemetry.`,
          400
        );
      }

      // If user has audit logs, nullify relation so user can be safely deleted without breaking historical audits
      if (targetUser._count.auditLogs > 0) {
        await prisma.auditLog.updateMany({
          where: { userId: id },
          data: { userId: null },
        });
      }

      await prisma.user.delete({
        where: { id },
      });

      const userAgent = Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'];

      await AuditService.log({
        userId: req.user?.id,
        action: AuditAction.DELETE,
        entity: 'User',
        entityId: id,
        oldValues: {
          username: targetUser.username,
          email: targetUser.email,
          fullName: targetUser.fullName,
          role: targetUser.role,
        },
        ipAddress: req.ip,
        userAgent,
      });

      return sendSuccess(res, { id }, `User '${targetUser.username}' deleted successfully`);
    } catch (error) {
      next(error);
    }
  }
}
