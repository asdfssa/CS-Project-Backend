/**
 * Cloudflare Turnstile Middleware
 * ตรวจสอบ cf-turnstile-response token ก่อนอนุญาตให้ผ่าน
 */
const config = require('../config');

async function verifyTurnstile(req, res, next) {
  // ข้าม verify ใน test environment
  if (config.env === 'test') return next();

  const token = req.body['cf-turnstile-response'];
  if (!token) {
    return res.status(400).json({
      success: false,
      code: 'TURNSTILE_MISSING',
      message: 'กรุณายืนยัน CAPTCHA ก่อนดำเนินการ',
    });
  }

  const secretKey = config.turnstile.secretKey;
  if (!secretKey) {
    // ถ้าไม่ได้ตั้ง secret key ใน env ให้ warn แล้วผ่านไปก่อน (development)
    console.warn('[Turnstile] TURNSTILE_SECRET_KEY not set — skipping verification');
    return next();
  }

  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token,
      remoteip: req.ip,
    });

    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v1/siteverify', {
      method: 'POST',
      body,
    });

    const data = await verifyRes.json();

    if (!data.success) {
      return res.status(403).json({
        success: false,
        code: 'TURNSTILE_FAILED',
        message: 'การยืนยัน CAPTCHA ล้มเหลว กรุณาลองใหม่',
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = verifyTurnstile;
