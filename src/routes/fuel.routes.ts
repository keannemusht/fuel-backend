import { Router } from 'express';
import { FuelController } from '../controllers/fuel.controller.js';
import { authenticateJwt } from '../middlewares/authMiddleware.js';
import { validateRequest } from '../middlewares/validate.js';
import { z } from 'zod';

import { requireRole } from '../middlewares/rbacMiddleware.js';
import { Role } from '@prisma/client';

const router = Router();

const recordDispenseSchema = z.object({
  body: z.object({
    unitId: z.string().min(1, 'Unit selection is required'),
    tankId: z.string().min(1, 'Storage tank selection is required'),
    currentKm: z.number().min(0, 'Current KM must be positive'),
    currentHm: z.number().min(0, 'Current HM must be positive'),
    volumeLiters: z.number().min(0, 'Volume Liters must be non-negative'),
    shift: z.string().min(1, 'Shift identifier is required (e.g. SHIFT 1, SHIFT 2)'),
    operator: z.string().min(1, 'Operator name is required'),
    fuelInLiters: z.number().min(0).optional(),
    bypassValidation: z.boolean().optional(),
    bypassReason: z.string().optional(),
    dateStr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD').optional(),
    jamStr: z.string().optional(),
  }),
});

const recordBackdateSchema = z.object({
  body: z.object({
    unitId: z.string().min(1, 'Unit selection is required'),
    tankId: z.string().min(1, 'Storage tank selection is required'),
    currentKm: z.number().min(0, 'Current KM must be positive'),
    currentHm: z.number().min(0, 'Current HM must be positive'),
    volumeLiters: z.number().min(0, 'Volume Liters must be non-negative'),
    shift: z.string().min(1, 'Shift identifier is required (e.g. SHIFT 1, SHIFT 2)'),
    operator: z.string().min(1, 'Operator name is required'),
    dateStr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
    jamStr: z.string().min(1, 'Time is required (e.g. 14:30)'),
    fuelInLiters: z.number().min(0).optional(),
    bypassValidation: z.boolean().optional(),
    bypassReason: z.string().optional(),
    fuelmanName: z.string().optional(),
  }),
});

router.use(authenticateJwt);

router.post('/dispense', validateRequest(recordDispenseSchema), FuelController.recordDispense);
router.get('/meter-context', FuelController.getMeterContext);
router.get('/operators', FuelController.getOperators);
router.post('/backdate', requireRole([Role.ADMIN, Role.MANAGEMENT]), validateRequest(recordBackdateSchema), FuelController.recordBackdate);
router.get('/logs', FuelController.getFuelLogs);
router.get('/summary', FuelController.getShiftSummary);
router.get('/monthly-summary', FuelController.getMonthlySummary);
router.post('/sync-month', requireRole([Role.ADMIN, Role.MANAGEMENT, Role.FUELMAN]), FuelController.syncMonthlyRecords);
router.post('/sync-master', requireRole([Role.ADMIN, Role.MANAGEMENT, Role.FUELMAN]), FuelController.syncMasterSheet);

// Historical Log CRUD (Admin & Management)
router.post('/logs', requireRole([Role.ADMIN, Role.MANAGEMENT]), FuelController.createHistoricalLog);
router.put('/logs/:id', requireRole([Role.ADMIN, Role.MANAGEMENT]), FuelController.updateHistoricalLog);
router.delete('/logs/:id', requireRole([Role.ADMIN, Role.MANAGEMENT]), FuelController.deleteHistoricalLog);

export default router;

