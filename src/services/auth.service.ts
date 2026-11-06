import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { config } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { Role } from '@prisma/client';

// Revoked tokens cache with automatic TTL cleanup
const revokedTokens = new Map<string, number>();

// Periodically purge expired revoked tokens
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of revokedTokens.entries()) {
    if (now > expiry) {
      revokedTokens.delete(token);
    }
  }
}, 15 * 60 * 1000);

export class AuthService {
  /**
   * Revoke an active access or refresh token upon logout
   */
  static revokeToken(token: string): void {
    if (!token) return;
    try {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      const expiryMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000;
      revokedTokens.set(token, expiryMs);
    } catch {
      revokedTokens.set(token, Date.now() + 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Check if a token has been explicitly invalidated / logged out
   */
  static isTokenRevoked(token: string): boolean {
    if (!token) return false;
    const expiry = revokedTokens.get(token);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      revokedTokens.delete(token);
      return false;
    }
    return true;
  }

  static async login(username: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      throw new AppError('Invalid username or password', 401);
    }

    if (!user.isActive) {
      throw new AppError('Account is disabled. Contact system administrator.', 403);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new AppError('Invalid username or password', 401);
    }

    const accessToken = jwt.sign(
      { userId: user.id, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as any }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn as any }
    );

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  static async refreshToken(refreshToken: string) {
    try {
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as { userId: string };
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || !user.isActive) {
        throw new AppError('User account invalid or inactive', 401);
      }

      const newAccessToken = jwt.sign(
        { userId: user.id, role: user.role },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn as any }
      );

      return { accessToken: newAccessToken };
    } catch (err: any) {
      throw new AppError('Invalid or expired refresh token', 401);
    }
  }

  static async createUser(data: {
    username: string;
    email: string;
    password: string;
    fullName: string;
    role: Role;
  }) {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username: data.username }, { email: data.email }],
      },
    });

    if (existing) {
      throw new AppError('Username or email already exists', 409);
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        passwordHash,
        fullName: data.fullName,
        role: data.role,
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return user;
  }
}
