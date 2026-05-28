/**
 * Rate Limiter
 * ป้องกัน brute force attack บน login และ OTP endpoints
 * Dev mode: skip rate limit สำหรับ localhost และ Docker internal network
 */
const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

// Skip localhost + Docker internal network ตอน dev
const skipLocalhost = (req) => {
  if (!isDev) return false;
  const ip = req.ip || req.connection?.remoteAddress || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.startsWith('172.') ||   // Docker bridge network
    ip.startsWith('192.168.') ||
    ip.startsWith('10.')
  );
};

// 5 login attempts per 15 min per IP (username/password)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'เข้าสู่ระบบเกินจำนวนครั้งที่กำหนด กรุณารอ 15 นาทีแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 30 attempts per 15 min per IP (Google OAuth — ไม่มี brute force risk)
const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'เข้าสู่ระบบเกินจำนวนครั้งที่กำหนด กรุณารอ 15 นาทีแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 10 OTP attempts per 10 min per IP
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'ป้อน OTP เกินจำนวนครั้งที่กำหนด กรุณารอแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 20 register attempts per 15 min per IP
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: skipLocalhost,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'ลงทะเบียนเกินจำนวนครั้งที่กำหนด กรุณารอ 15 นาทีแล้วลองใหม่',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, googleLimiter, otpLimiter, registerLimiter };
