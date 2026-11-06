import dotenv from 'dotenv';
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

// Strict security guard: In production, secrets MUST be supplied via environment variables
if (isProduction && (!process.env.JWT_SECRET || !process.env.REFRESH_TOKEN_SECRET)) {
  throw new Error(
    'CRITICAL SECURITY CONFIGURATION ERROR: JWT_SECRET and REFRESH_TOKEN_SECRET must be explicitly defined in production!'
  );
}

export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwt: {
    secret: process.env.JWT_SECRET || (isProduction ? '' : 'dev_insecure_jwt_secret_only_for_local'),
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || (isProduction ? '' : 'dev_insecure_refresh_secret_only_for_local'),
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  },
  googleSheets: {
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
    sheetName: process.env.GOOGLE_SHEET_NAME || 'LOG FUEL MONITORING',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
};
