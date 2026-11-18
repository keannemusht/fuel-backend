import { Router } from 'express';
import { ReconciliationController } from '../controllers/reconciliation.controller.js';
import { authenticateJwt } from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/rbacMiddleware.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticateJwt);

// Health audit and diagnostics accessible to ADMIN & MANAGEMENT
router.get('/health', requireRole([Role.ADMIN, Role.MANAGEMENT]), ReconciliationController.getHealth);
router.get('/history', requireRole([Role.ADMIN, Role.MANAGEMENT]), ReconciliationController.getHistory);

// Mutation operations strictly restricted to ADMIN
router.post('/apply', requireRole([Role.ADMIN]), ReconciliationController.applyFixes);
router.post('/rollback', requireRole([Role.ADMIN]), ReconciliationController.rollback);

export default router;
