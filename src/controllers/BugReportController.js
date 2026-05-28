/**
 * BugReportController
 * จัดการ request/response สำหรับ Bug Report
 *
 * Endpoints:
 *   POST  /api/bug-reports              → ผู้ใช้รายงานปัญหา (ทุก role)
 *   GET   /api/bug-reports              → Admin ดูรายการทั้งหมด (filter + pagination)
 *   GET   /api/bug-reports/my           → ผู้ใช้ดูรายงานของตัวเอง
 *   GET   /api/bug-reports/:id          → ดูรายละเอียด
 *   PATCH /api/bug-reports/:id/status   → Admin อัปเดต status
 */
const BugReportModel = require('../models/BugReportModel');

const VALID_CATEGORIES = ['scraper', 'form', 'auth', 'notification', 'other'];
const VALID_STATUSES   = ['open', 'in_progress', 'resolved', 'wontfix'];

class BugReportController {
  // ============================================================
  // POST /api/bug-reports
  // Role: ทุก role (Student, Supervisor, Staff, Admin, SuperAdmin)
  // ============================================================
  static async submit(req, res) {
    try {
      const reportedBy = req.user.sub;
      const { category, title, description, page_url, screenshot_path } = req.body;

      // --- Validate ---
      if (!category || !title || !description) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_FIELDS',
          message: 'กรุณากรอก category, title และ description',
        });
      }
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CATEGORY',
          message: `category ต้องเป็นหนึ่งใน: ${VALID_CATEGORIES.join(', ')}`,
        });
      }
      if (title.trim().length < 5) {
        return res.status(400).json({
          success: false,
          code: 'TITLE_TOO_SHORT',
          message: 'title ต้องมีความยาวอย่างน้อย 5 ตัวอักษร',
        });
      }
      if (description.trim().length < 10) {
        return res.status(400).json({
          success: false,
          code: 'DESCRIPTION_TOO_SHORT',
          message: 'description ต้องมีความยาวอย่างน้อย 10 ตัวอักษร',
        });
      }

      const reportId = await BugReportModel.create(
        reportedBy,
        category,
        title.trim(),
        description.trim(),
        page_url   || null,
        screenshot_path || null
      );

      return res.status(201).json({
        success: true,
        message: 'ส่งรายงานปัญหาเรียบร้อยแล้ว',
        data: { report_id: reportId },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ============================================================
  // GET /api/bug-reports
  // Role: Admin, SuperAdmin
  // Query: ?status=open&category=scraper&search=xxx&page=1&limit=20
  // ============================================================
  static async getAll(req, res) {
    try {
      const { status, category, search, page = 1, limit = 20 } = req.query;

      if (status && !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_STATUS',
          message: `status ต้องเป็นหนึ่งใน: ${VALID_STATUSES.join(', ')}`,
        });
      }
      if (category && !VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CATEGORY',
          message: `category ต้องเป็นหนึ่งใน: ${VALID_CATEGORIES.join(', ')}`,
        });
      }

      const result = await BugReportModel.findAll({
        status,
        category,
        search,
        page: parseInt(page),
        limit: parseInt(limit),
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ============================================================
  // GET /api/bug-reports/my
  // Role: ทุก role
  // Query: ?page=1&limit=20
  // ============================================================
  static async getMy(req, res) {
    try {
      const userId = req.user.sub;
      const { page = 1, limit = 20 } = req.query;

      const result = await BugReportModel.findByUser(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ============================================================
  // GET /api/bug-reports/:id
  // Role: Admin/SuperAdmin ดูได้ทุกรายการ | ผู้ใช้ทั่วไปดูได้เฉพาะของตัวเอง
  // ============================================================
  static async getById(req, res) {
    try {
      const reportId = parseInt(req.params.id);
      const { sub: userId, role } = req.user;

      const report = await BugReportModel.findById(reportId);
      if (!report) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบรายงานนี้' });
      }

      // ผู้ใช้ทั่วไปเห็นได้เฉพาะของตัวเอง
      const isAdmin = ['Admin', 'SuperAdmin'].includes(role);
      if (!isAdmin && report.reporter_id !== userId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์เข้าถึงรายงานนี้' });
      }

      return res.json({ success: true, data: report });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ============================================================
  // PATCH /api/bug-reports/:id/status
  // Role: Admin, SuperAdmin
  // Body: { status: 'in_progress'|'resolved'|'wontfix', resolved_note?: string }
  // ============================================================
  static async updateStatus(req, res) {
    try {
      const reportId = parseInt(req.params.id);
      const resolvedBy = req.user.sub;
      const { status, resolved_note } = req.body;

      if (!status) {
        return res.status(400).json({ success: false, code: 'MISSING_FIELDS', message: 'กรุณาระบุ status' });
      }
      // Admin ปรับได้ทุก status ยกเว้น 'open' (open คือสถานะเริ่มต้น ระบบตั้งให้อัตโนมัติ)
      const allowedStatuses = ['in_progress', 'resolved', 'wontfix'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_STATUS',
          message: `Admin เปลี่ยนได้เฉพาะ: ${allowedStatuses.join(', ')}`,
        });
      }

      const report = await BugReportModel.findById(reportId);
      if (!report) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบรายงานนี้' });
      }

      const updated = await BugReportModel.updateStatus(reportId, status, resolvedBy, resolved_note || null);
      if (!updated) {
        return res.status(500).json({ success: false, message: 'อัปเดตไม่สำเร็จ' });
      }

      return res.json({
        success: true,
        message: `อัปเดตสถานะเป็น "${status}" เรียบร้อยแล้ว`,
        data: { report_id: reportId, status },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

module.exports = BugReportController;