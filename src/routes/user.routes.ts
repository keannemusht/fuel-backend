import { Router } from 'express';
import { UserController } from '../controllers/user.controller.js';
import { authenticateJwt } from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/rbacMiddleware.js';
import { validateRequest } from '../middlewares/validate.js';
import { Role } from '@prisma/client';
import { z } from 'zod';

const router = Router();

const createUserSchema = z.object({
  body: z.object({
    username: z.string().min(3, 'Username must be at least 3 characters').regex(/^[a-zA-Z0-9._-]+$/, 'Username can only contain letters, numbers, dots, dashes and underscores'),
    email: z.string().email('Invalid email address'),
    fullName: z.string().min(2, 'Full name is required'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    role: z.nativeEnum(Role).optional(),
    isActive: z.boolean().optional(),
  }),
});

const updateUserSchema = z.object({
  body: z.object({
    fullName: z.string().min(2, 'Full name is required').optional(),
    email: z.string().email('Invalid email address').optional(),
    role: z.nativeEnum(Role).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal('')),
  }),
});

// All user management routes require valid JWT and ADMIN role
router.use(authenticateJwt);
router.use(requireRole([Role.ADMIN]));

router.get('/', UserController.getUsers);
router.get('/:id', UserController.getUserById);
router.post('/', validateRequest(createUserSchema), UserController.createUser);
router.put('/:id', validateRequest(updateUserSchema), UserController.updateUser);
router.delete('/:id', UserController.deleteUser);

export default router;
