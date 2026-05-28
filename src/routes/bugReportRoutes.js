/**
 * Bug Report Routes
 * Base path: /api/bug-reports
 */
const express               = require('express');
const router                = express.Router();
const BugReportController   = require('../controllers/BugReportController');
const { requireAuth, requireRole } = require('../middlewares/auth');

// -------------------------------------------------------
// ผู้ใช้รายงานปัญหา (ทุก role)
// POST /api/bug-reports
// Body: { category, title, description, page_url?, screenshot_path? }
// -------------------------------------------------------
router.post(
  '/',
  requireAuth,
  BugReportController.submit
);

// -------------------------------------------------------
// ผู้ใช้ดูรายงานของตัวเอง
// GET /api/bug-reports/my
// Query: ?page=1&limit=20
// -------------------------------------------------------
router.get(
  '/my',
  requireAuth,
  BugReportController.getMy
);

// -------------------------------------------------------
// Admin ดูรายการทั้งหมด
// GET /api/bug-reports
// Query: ?status=open&category=scraper&search=xxx&page=1&limit=20
// -------------------------------------------------------
router.get(
  '/',
  requireAuth,
  requireRole('Admin', 'SuperAdmin'),
  BugReportController.getAll
);

// -------------------------------------------------------
// ดูรายละเอียด (Admin เห็นทุกรายการ, ผู้ใช้เห็นเฉพาะของตัวเอง)
// GET /api/bug-reports/:id
// -------------------------------------------------------
router.get(
  '/:id',
  requireAuth,
  BugReportController.getById
);

// -------------------------------------------------------
// Admin อัปเดต status
// PATCH /api/bug-reports/:id/status
// Body: { status: 'in_progress'|'resolved'|'wontfix', resolved_note?: string }
// -------------------------------------------------------
router.patch(
  '/:id/status',
  requireAuth,
  requireRole('Admin', 'SuperAdmin'),
  BugReportController.updateStatus
);

module.exports = router;