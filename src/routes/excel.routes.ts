import { Router } from 'express';
import multer from 'multer';
import { ExcelController } from '../controllers/excel.controller.js';
import { authenticateJwt } from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/rbacMiddleware.js';
import { Role } from '@prisma/client';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

const router = Router();

router.use(authenticateJwt);

// Export and Template downloads are accessible to authenticated users
router.get('/export', ExcelController.exportShiftExcel);
router.get('/template', ExcelController.getTemplate);

// Batch Imports are restricted to ADMIN and MANAGEMENT
router.post('/import', requireRole([Role.ADMIN, Role.MANAGEMENT]), upload.single('file'), ExcelController.batchImport);
router.post('/import-fuel', requireRole([Role.ADMIN, Role.MANAGEMENT]), upload.single('file'), ExcelController.batchImport);
router.post('/import-units', requireRole([Role.ADMIN, Role.MANAGEMENT]), upload.single('file'), ExcelController.importUnits);

export default router;
