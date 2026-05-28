/**
 * Global Error Handler
 * จับ error ที่ throw จาก controller/service แล้วแปลงเป็น HTTP response
 */
const { AuthError } = require('../services/AuthService');
const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  // AuthError ที่เรา throw เอง
  if (err instanceof AuthError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }

  // Unexpected error
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}

module.exports = { errorHandler, notFoundHandler };
