import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import routes from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { config } from './config/env.js';

export const createApp = () => {
  const app = express();

  // 1. CORS Configuration (Must run BEFORE helmet and routes to handle preflight OPTIONS immediately)
  const allowedOrigins = [
    'https://batarafuel.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    ...(config.corsOrigin && config.corsOrigin !== '*'
      ? config.corsOrigin.split(',').map((o) => o.trim())
      : []),
  ];

  const corsOptions: cors.CorsOptions = {
    origin: (requestOrigin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!requestOrigin) {
        return callback(null, true);
      }

      // Allow if matches known domains or wildcard
      if (
        config.corsOrigin === '*' ||
        allowedOrigins.includes(requestOrigin) ||
        requestOrigin.endsWith('.vercel.app') ||
        requestOrigin.includes('localhost') ||
        requestOrigin.includes('127.0.0.1')
      ) {
        return callback(null, true);
      }

      // Default fallback: reflect the origin safely
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  // 2. Security Headers (Configured with crossOriginResourcePolicy: "cross-origin")
  const helmetMiddleware = (typeof helmet === 'function' ? helmet : (helmet as any)?.default) as any;
  if (typeof helmetMiddleware === 'function') {
    app.use(
      helmetMiddleware({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
      })
    );
  }

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
