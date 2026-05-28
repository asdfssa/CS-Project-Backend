/**
 * Application Configuration
 * โหลด environment variables และ validate ค่าที่จำเป็น
 */
require('dotenv').config();

const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,

  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    socketPath: process.env.DB_SOCKET || undefined,
    connectionLimit: 10,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',  // เปลี่ยนจาก 2h → 15m
    otpExpiresIn: process.env.JWT_OTP_EXPIRES_IN || '10m',
    refreshExpiresMs: parseInt(process.env.JWT_REFRESH_EXPIRES_MS, 10) || 7 * 24 * 60 * 60 * 1000, // 7 วัน
  },

  otp: {
    length: parseInt(process.env.OTP_LENGTH, 10) || 6,
    expiresMinutes: parseInt(process.env.OTP_EXPIRES_MINUTES, 10) || 10,
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5,
  },

  login: {
    maxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 5,
    lockoutMinutes: parseInt(process.env.LOGIN_LOCKOUT_MINUTES, 10) || 15,
  },

  mail: {
    mode: process.env.MAIL_MODE || 'console',
    from: process.env.MAIL_FROM || 'noreply@example.com',
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },
    google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    allowedDomain: process.env.GOOGLE_ALLOWED_DOMAIN || 'msu.ac.th',
  },
  scopus: {
    apiKeys: [
      process.env.SCOPUS_API_KEY_1,
      process.env.SCOPUS_API_KEY_2,
      process.env.SCOPUS_API_KEY_3,
    ].filter(Boolean),
    baseUrl: 'https://api.elsevier.com',
    cacheExpiryDays: 7,
  },

  scraper: {
    headless: process.env.SCRAPER_HEADLESS !== 'false',
    slowMo: parseInt(process.env.SCRAPER_SLOW_MO, 10) || 400,
  },
};
