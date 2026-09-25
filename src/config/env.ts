import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwt: {
    secret: process.env.JWT_SECRET || 'fms_core_super_secret_jwt_key_default',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'fms_core_refresh_token_secret_default',
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
