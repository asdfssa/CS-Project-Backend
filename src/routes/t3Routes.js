/**
 * T3 Routes
 * Base path: /api/t3
 */
const express       = require('express');
const router        = express.Router();
const T3Controller  = require('../controllers/T3Controller');
const { requireAuth, requireRole } = require('../middlewares/auth');

// -------------------------------------------------------
// นิสิตยื่น T3 ใหม่
// POST /api/t3
// -------------------------------------------------------
router.post(
  '/',
  requireAuth,
  requireRole('Student'),
  T3Controller.submit
);

// -------------------------------------------------------
// นิสิตดูประวัติของตัวเอง
// GET /api/t3/my
// -------------------------------------------------------
router.get(
  '/my',
  requireAuth,
  requireRole('Student'),
  T3Controller.getMyRequests
);

// -------------------------------------------------------
// Advisor/Staff ดูรายการที่รออนุมัติ
// GET /api/t3/pending
// -------------------------------------------------------
router.get(
  '/pending',
  requireAuth,
  requireRole('Supervisor', 'Staff'),
  T3Controller.getPending
);

// -------------------------------------------------------
// ดูรายละเอียด T3 ตาม ID
// GET /api/t3/:id
// -------------------------------------------------------
router.get(
  '/:id',
  requireAuth,
  requireRole('Student', 'Supervisor', 'Staff', 'Admin', 'SuperAdmin'),
  T3Controller.getById
);

// -------------------------------------------------------
// Advisor อนุมัติ/ปฏิเสธ
// PATCH /api/t3/:id/advisor-review
// Body: { action: 'approve'|'reject', remark?: string }
// -------------------------------------------------------
router.patch(
  '/:id/advisor-review',
  requireAuth,
  requireRole('Supervisor'),
  T3Controller.advisorReview
);

// -------------------------------------------------------
// Staff บันทึกมติ Faculty Com
// PATCH /api/t3/:id/faculty-review
// Body: { action: 'approve'|'reject', meeting_no?, meeting_date?, remark? }
// -------------------------------------------------------
router.patch(
  '/:id/faculty-review',
  requireAuth,
  requireRole('Staff'),
  T3Controller.facultyReview
);

// -------------------------------------------------------
// Staff บันทึกผลจาก Grad School (หลังได้รับอีเมลตอบกลับ)
// PATCH /api/t3/:id/grad-school-review
// Body: { action: 'approve'|'reject', approved_by_email?, remark? }
// -------------------------------------------------------
router.patch(
  '/:id/grad-school-review',
  requireAuth,
  requireRole('Staff'),
  T3Controller.gradSchoolReview
);

// -------------------------------------------------------
// นิสิตยกเลิกคำขอของตัวเอง (Pending หรือ Rejected เท่านั้น)
// PATCH /api/t3/:id/cancel
// -------------------------------------------------------
router.patch(
  '/:id/cancel',
  requireAuth,
  requireRole('Student'),
  T3Controller.cancel
);

module.exports = router;