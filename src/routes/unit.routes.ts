import { Router } from 'express';
import { UnitController } from '../controllers/unit.controller.js';
import { authenticateJwt } from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/rbacMiddleware.js';
import { validateRequest } from '../middlewares/validate.js';
import { Role, UnitCategory } from '@prisma/client';
import { z } from 'zod';

const router = Router();

const createUnitSchema = z.object({
  body: z.object({
    unitCode: z.string().min(2, 'Unit Code is required'),
    plateNumber: z.string().optional(),
    category: z.nativeEnum(UnitCategory),
    makeModel: z.string().optional(),
    lastKm: z.number().min(0).optional(),
    lastHm: z.number().min(0).optional(),
  }),
});

const updateUnitSchema = z.object({
  body: z.object({
    plateNumber: z.string().optional(),
    category: z.nativeEnum(UnitCategory).optional(),
    makeModel: z.string().optional(),
    lastKm: z.number().min(0).optional(),
    lastHm: z.number().min(0).optional(),
    isActive: z.boolean().optional(),
  }),
});

router.use(authenticateJwt);

router.get('/', UnitController.getUnits);
router.get('/:id', UnitController.getUnitById);
router.post('/', requireRole([Role.ADMIN, Role.MANAGEMENT]), validateRequest(createUnitSchema), UnitController.createUnit);
router.put('/:id', requireRole([Role.ADMIN, Role.MANAGEMENT]), validateRequest(updateUnitSchema), UnitController.updateUnit);
router.delete('/:id', requireRole([Role.ADMIN, Role.MANAGEMENT]), UnitController.deleteUnit);

export default router;
