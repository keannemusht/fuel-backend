import { Router } from 'express';
import authRoutes from './auth.routes.js';
import fuelRoutes from './fuel.routes.js';
import unitRoutes from './unit.routes.js';
import tankRoutes from './tank.routes.js';
import userRoutes from './user.routes.js';
import auditRoutes from './audit.routes.js';
import syncRoutes from './sync.routes.js';
import excelRoutes from './excel.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/fuel', fuelRoutes);
router.use('/units', unitRoutes);
router.use('/tanks', tankRoutes);
router.use('/audit', auditRoutes);
router.use('/sync', syncRoutes);
router.use('/excel', excelRoutes);

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'HEALTHY',
    service: 'Batara FMS-Core Backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
