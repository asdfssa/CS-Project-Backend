/**
 * errorResponse.js
 * แปลง error ดิบ (MySQL, JWT, FS, ฯลฯ) เป็น Thai-friendly response
 * ใช้ใน catch block ของทุก controller
 */
const logger = require('./logger');

// ─── MySQL / DB errors ────────────────────────────────────────────────────────
const MYSQL_ERRORS = {
  ER_DUP_ENTRY:               { code: 'DUPLICATE_ENTRY',       message: 'ข้อมูลนี้มีอยู่ในระบบแล้ว (ข้อมูลซ้ำ)' },
  ER_NO_REFERENCED_ROW_2:     { code: 'REFERENCE_NOT_FOUND',   message: 'ข้อมูลที่อ้างอิงไม่มีในระบบ' },
  ER_ROW_IS_REFERENCED_2:     { code: 'REFERENCE_EXISTS',      message: 'ไม่สามารถลบได้ เนื่องจากมีข้อมูลอื่นอ้างอิงอยู่' },
  ER_BAD_NULL_ERROR:          { code: 'NULL_NOT_ALLOWED',       message: 'มีข้อมูลที่จำเป็นต้องกรอกแต่ไม่ได้ส่งมา' },
  ER_DATA_TOO_LONG:           { code: 'DATA_TOO_LONG',          message: 'ข้อมูลที่ส่งมายาวเกินกำหนด' },
  ER_INCORRECT_DATETIME_VALUE:{ code: 'INVALID_DATETIME',       message: 'รูปแบบวันที่-เวลาไม่ถูกต้อง' },
  ER_TRUNCATED_WRONG_VALUE:   { code: 'INVALID_VALUE',          message: 'ค่าข้อมูลไม่ถูกต้อง (ค่าไม่ตรงกับชนิดคอลัมน์)' },
  ER_WARN_DATA_OUT_OF_RANGE:  { code: 'VALUE_OUT_OF_RANGE',     message: 'ค่าข้อมูลเกินช่วงที่รองรับ' },
  ER_PARSE_ERROR:             { code: 'DB_QUERY_ERROR',         message: 'คำสั่ง SQL ผิดพลาด กรุณาแจ้ง developer' },
  ER_ACCESS_DENIED_ERROR:     { code: 'DB_AUTH_ERROR',          message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ (auth failed)' },
  ER_CON_COUNT_ERROR:         { code: 'DB_TOO_MANY_CONN',       message: 'ฐานข้อมูลมีการเชื่อมต่อเกินกำหนด' },
  ECONNREFUSED:               { code: 'DB_CONNECTION_REFUSED',  message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ (connection refused)' },
  PROTOCOL_CONNECTION_LOST:   { code: 'DB_CONNECTION_LOST',     message: 'การเชื่อมต่อฐานข้อมูลหลุด กรุณาลองใหม่' },
  ENOTFOUND:                  { code: 'DB_HOST_NOT_FOUND',      message: 'ไม่พบ host ฐานข้อมูล กรุณาตรวจสอบ config' },
};

// ─── JWT errors ───────────────────────────────────────────────────────────────
const JWT_ERRORS = {
  JsonWebTokenError: { code: 'INVALID_TOKEN',    message: 'Token ไม่ถูกต้องหรือถูกแก้ไข' },
  TokenExpiredError: { code: 'TOKEN_EXPIRED',    message: 'Token หมดอายุแล้ว กรุณา login ใหม่' },
  NotBeforeError:    { code: 'TOKEN_NOT_ACTIVE', message: 'Token ยังไม่สามารถใช้งานได้' },
};

// ─── File system errors ───────────────────────────────────────────────────────
const FS_ERRORS = {
  ENOENT: { code: 'FILE_NOT_FOUND',    message: 'ไม่พบไฟล์ที่ระบุในระบบ' },
  EACCES: { code: 'FILE_ACCESS_DENIED',message: 'ไม่มีสิทธิ์เข้าถึงไฟล์' },
  ENOSPC: { code: 'DISK_FULL',         message: 'พื้นที่เก็บข้อมูลเต็ม กรุณาติดต่อ admin' },
};

// ─── Parse error → Thai message ──────────────────────────────────────────────
function parseError(err) {
  if (!err) {
    return { code: 'UNKNOWN_ERROR', message: 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ', raw: 'unknown' };
  }

  // MySQL
  if (err.code && MYSQL_ERRORS[err.code]) {
    return { ...MYSQL_ERRORS[err.code], raw: err.message };
  }

  // JWT
  if (err.name && JWT_ERRORS[err.name]) {
    return { ...JWT_ERRORS[err.name], raw: err.message };
  }

  // File system
  if (err.code && FS_ERRORS[err.code]) {
    return { ...FS_ERRORS[err.code], raw: err.message };
  }

  // Multer (file upload)
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return { code: 'FILE_TOO_LARGE',  message: 'ไฟล์ที่อัปโหลดมีขนาดใหญ่เกินกำหนด',        raw: err.message };
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return { code: 'TOO_MANY_FILES',  message: 'จำนวนไฟล์ที่อัปโหลดเกินกำหนด',              raw: err.message };
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return { code: 'UNEXPECTED_FILE', message: `ไม่รองรับ field ไฟล์ชื่อ "${err.field}"`,   raw: err.message };
    }
    return { code: 'UPLOAD_ERROR', message: 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์', raw: err.message };
  }

  // Invalid JSON body
  if (err instanceof SyntaxError && err.status === 400 && err.body) {
    return { code: 'INVALID_JSON', message: 'รูปแบบ JSON ที่ส่งมาไม่ถูกต้อง', raw: err.message };
  }

  // Default
  return {
    code: 'SERVER_ERROR',
    message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง หรือติดต่อ admin',
    raw: err.message || String(err),
  };
}

// ─── serverError — ใช้ใน catch block ของ controller ─────────────────────────
/**
 * @param {import('express').Response} res
 * @param {Error} err
 * @param {string} location  - ชื่อ controller.method เช่น 'PreT3Controller.submit'
 */
function serverError(res, err, location) {
  const parsed = parseError(err);

  logger.error(`[${location}] ${parsed.code}: ${parsed.raw}`, { stack: err.stack });

  const body = {
    success: false,
    code: parsed.code,
    message: parsed.message,
  };

  // ในโหมด dev แนบข้อมูล debug มาด้วยเพื่อให้ frontend / dev console เห็น
  if (process.env.NODE_ENV !== 'production') {
    body.debug = {
      location,
      error_type:  err.name || err.code || 'Error',
      raw_message: parsed.raw,
      timestamp:   new Date().toISOString(),
    };
  }

  return res.status(500).json(body);
}

module.exports = { parseError, serverError };
