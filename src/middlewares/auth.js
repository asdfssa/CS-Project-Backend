/**
 * Auth Middleware
 * - requireAuth   : ต้องมี access token (full login)
 * - requireOtpToken : ต้องมี OTP token (ระหว่างขั้น verify OTP)
 * - requireRole   : ตรวจ role
 */
const jwtUtil = require('../utils/jwt');

function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_TOKEN',
      message: 'Authentication required',
    });
  }
  try {
    const payload = jwtUtil.verifyToken(token);
    if (payload.type !== 'access') {
      return res.status(401).json({
        success: false,
        code: 'WRONG_TOKEN_TYPE',
        message: 'Invalid token type',
      });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired token',
    });
  }
}

function requireOtpToken(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_OTP_TOKEN',
      message: 'OTP token required',
    });
  }
  try {
    const payload = jwtUtil.verifyToken(token);
    if (payload.type !== 'otp_pending') {
      return res.status(401).json({
        success: false,
        code: 'WRONG_TOKEN_TYPE',
        message: 'Invalid token type',
      });
    }
    req.otpUserId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      code: 'OTP_TOKEN_EXPIRED',
      message: 'OTP session expired. Please login again',
    });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireOtpToken, requireRole };
