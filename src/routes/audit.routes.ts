import { Router } from 'express';
import { AuditController } from '../controllers/audit.controller.js';
import { authenticateJwt } from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/rbacMiddleware.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticateJwt);
router.get('/', requireRole([Role.ADMIN, Role.MANAGEMENT]), AuditController.getLogs);
router.get('/:id', requireRole([Role.ADMIN, Role.MANAGEMENT]), AuditController.getLogById);
router.post('/', requireRole([Role.ADMIN]), AuditController.createLog);
router.put('/:id', requireRole([Role.ADMIN]), AuditController.updateLog);
router.delete('/clear', requireRole([Role.ADMIN]), AuditController.clearLogs);
router.delete('/:id', requireRole([Role.ADMIN]), AuditController.deleteLog);

export default router;
