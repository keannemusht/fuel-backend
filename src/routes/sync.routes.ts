import { Router } from 'express';
import { SyncController } from '../controllers/sync.controller.js';
import { authenticateJwt } from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/rbacMiddleware.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticateJwt);

router.get('/status', SyncController.getSyncStatus);
router.post('/trigger', requireRole([Role.ADMIN, Role.MANAGEMENT, Role.FUELMAN]), SyncController.triggerManualSync);

export default router;
