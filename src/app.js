/**
 * Express Application
 * ตั้งค่า middleware ทั่วไป + mount routes
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const config = require('./config');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');
const cookieParser = require('cookie-parser');
const app = express();

// Trust proxy (สำหรับเอา real IP ตอน deploy หลัง reverse proxy)
app.set('trust proxy', 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // ปิดเพราะหน้า test ใช้ inline script
  })
);

// CORS
app.use(
  cors({
    origin: config.cors.origin,
    credentials: true,
  })
);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser()); 
// Static files (UI สำหรับทดสอบ)
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/v3', routes);

// 404 handler (สำหรับ /api/v3/* ที่ไม่มี)
app.use('/api/v3', notFoundHandler);

// Global error handler
app.use(errorHandler);

module.exports = app;
