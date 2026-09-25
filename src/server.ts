import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { GoogleSheetsService } from './services/googleSheets.service.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`=======================================================`);
  logger.info(` BATARA FMS-CORE FUEL MONITORING BACKEND ENGINE ACTIVE `);
  logger.info(` Mode: ${config.nodeEnv.toUpperCase()} | Port: ${config.port} `);
  logger.info(` API Health: http://localhost:${config.port}/api/health `);
  logger.info(`=======================================================`);

  // Background Sync Queue Worker (Runs every 30 seconds to retry failed/pending rows)
  setInterval(async () => {
    try {
      const stats = await GoogleSheetsService.processSyncQueue();
      if (stats.processed > 0) {
        logger.info(`Background Google Sheets Sync Queue Processed: ${stats.succeeded} synced, ${stats.failed} failed out of ${stats.processed}`);
      }
    } catch (err: any) {
      logger.error('Background Sync Worker Error:', err.message);
    }
  }, 30000);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Process terminated.');
  });
});
