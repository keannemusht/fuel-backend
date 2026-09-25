import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import routes from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { config } from './config/env.js';

export const createApp = () => {
  const app = express();

  // Security Headers (NodeNext ESM & CJS interoperability safe)
  const helmetMiddleware = (typeof helmet === 'function' ? helmet : (helmet as any)?.default) as any;
  if (typeof helmetMiddleware === 'function') {
    app.use(helmetMiddleware());
  }

  // CORS Configuration
  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : [config.corsOrigin, 'http://localhost:3000', 'http://127.0.0.1:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Rate Limiting (Defense against brute force on auth and heavy endpoints)
  const rateLimitMiddleware = (typeof rateLimit === 'function' ? rateLimit : (rateLimit as any)?.default) as any;
  const limiter = rateLimitMiddleware({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Limit each IP to 500 requests per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests from this IP. Please try again after 15 minutes.',
    },
  });
  app.use('/api', limiter);

  // Body Parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Root Check
  app.get('/', (_req, res) => {
    res.status(200).json({
      status: 'ONLINE',
      service: 'Batara FMS-Core Backend API',
      health: '/api/health',
      timestamp: new Date().toISOString(),
    });
  });

  // API Routes
  app.use('/api', routes);

  // Global Error Handler
  app.use(errorHandler);

  return app;
};
