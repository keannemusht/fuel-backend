import { Router } from 'express';
import { TankController } from '../controllers/tank.controller.js';
import { authenticateJwt } from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/rbacMiddleware.js';
import { validateRequest } from '../middlewares/validate.js';
import { Role } from '@prisma/client';
import { z } from 'zod';

const router = Router();

const refillTankSchema = z.object({
  body: z.object({
    refilledLiters: z.number().min(1, 'Refilled liters must be greater than 0'),
    notes: z.string().optional(),
  }),
});

const createTankSchema = z.object({
  body: z.object({
    tankCode: z.string().min(2, 'Tank code is required'),
    name: z.string().min(2, 'Tank name is required'),
    capacityLiters: z.number().positive('Capacity must be greater than 0'),
    currentStockLiters: z.number().min(0, 'Current stock must be non-negative'),
    minStockAlertLiters: z.number().min(0, 'Alert stock level must be non-negative').optional(),
    fuelType: z.string().optional(),
  }),
});

const updateTankSchema = z.object({
  body: z.object({
    tankCode: z.string().min(2).optional(),
    name: z.string().min(2).optional(),
    capacityLiters: z.number().positive().optional(),
    currentStockLiters: z.number().min(0).optional(),
    minStockAlertLiters: z.number().min(0).optional(),
    fuelType: z.string().optional(),
  }),
});

router.use(authenticateJwt);

router.get('/', TankController.getTanks);
router.post('/', requireRole([Role.ADMIN, Role.MANAGEMENT]), validateRequest(createTankSchema), TankController.createTank);
router.put('/:id', requireRole([Role.ADMIN, Role.MANAGEMENT]), validateRequest(updateTankSchema), TankController.updateTank);
router.delete('/:id', requireRole([Role.ADMIN, Role.MANAGEMENT]), TankController.deleteTank);
router.post('/:id/refill', requireRole([Role.ADMIN, Role.MANAGEMENT]), validateRequest(refillTankSchema), TankController.refillTank);

export default router;
