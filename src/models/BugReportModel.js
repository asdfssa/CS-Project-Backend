/**
 * BugReportModel
 * Data access layer สำหรับ table `journal_watch.bug_reports`
 * ใช้ fully-qualified table name เพื่อหลีกเลี่ยงปัญหา session-level database
 */
const db = require('../config/database');

class BugReportModel {
  // ============================================================
  // CREATE
  // ============================================================

  /**
   * ผู้ใช้ส่ง bug report ใหม่
   * @param {number} reportedBy     - user_id
   * @param {string} category       - scraper | form | auth | notification | other
   * @param {string} title
   * @param {string} description
   * @param {string|null} pageUrl
   * @param {string|null} screenshotPath
   * @returns {number} report_id ที่สร้างใหม่
   */
  static async create(reportedBy, category, title, description, pageUrl = null, screenshotPath = null) {
    const [result] = await db.query(
      `INSERT INTO journal_watch.bug_reports
         (reported_by, category, title, description, page_url, screenshot_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [reportedBy, category, title, description, pageUrl, screenshotPath]
    );
    return result.insertId;
  }

  // ============================================================
  // READ
  // ============================================================

  /**
   * ดึงรายการ bug reports ทั้งหมด (Admin)
   * รองรับ filter: status, category, search และ pagination
   */
  static async findAll({ status, category, search, page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (status)   { conditions.push('br.status = ?');   params.push(status); }
    if (category) { conditions.push('br.category = ?'); params.push(category); }
    if (search) {
      conditions.push('(br.title LIKE ? OR br.description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT
         br.report_id,
         br.category,
         br.title,
         br.description,
         br.page_url,
         br.screenshot_path,
         br.status,
         br.resolved_note,
         br.resolved_at,
         br.created_at,
         br.updated_at,
         -- ผู้รายงาน
         u.user_id    AS reporter_id,
         u.first_name AS reporter_first_name,
         u.last_name  AS reporter_last_name,
         u.msu_mail   AS reporter_email,
         u.role       AS reporter_role,
         -- Admin ที่ resolve
         a.user_id    AS resolver_id,
         a.first_name AS resolver_first_name,
         a.last_name  AS resolver_last_name
       FROM journal_watch.bug_reports br
       JOIN journal_watch.users u ON u.user_id = br.reported_by
       LEFT JOIN journal_watch.users a ON a.user_id = br.resolved_by
       ${where}
       ORDER BY br.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM journal_watch.bug_reports br
       ${where}`,
      params
    );

    return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * ดึง bug reports ของตัวเอง (ผู้ใช้ทั่วไป)
   */
  static async findByUser(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT
         report_id, category, title, description,
         page_url, screenshot_path, status,
         resolved_note, resolved_at, created_at, updated_at
       FROM journal_watch.bug_reports
       WHERE reported_by = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM journal_watch.bug_reports WHERE reported_by = ?`,
      [userId]
    );

    return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * ดึงรายละเอียด bug report ตาม ID
   */
  static async findById(reportId) {
    const [rows] = await db.query(
      `SELECT
         br.*,
         u.user_id    AS reporter_id,
         u.first_name AS reporter_first_name,
         u.last_name  AS reporter_last_name,
         u.msu_mail   AS reporter_email,
         u.role       AS reporter_role,
         a.user_id    AS resolver_id,
         a.first_name AS resolver_first_name,
         a.last_name  AS resolver_last_name
       FROM journal_watch.bug_reports br
       JOIN journal_watch.users u ON u.user_id = br.reported_by
       LEFT JOIN journal_watch.users a ON a.user_id = br.resolved_by
       WHERE br.report_id = ?`,
      [reportId]
    );
    return rows[0] || null;
  }

  // ============================================================
  // UPDATE
  // ============================================================

  /**
   * Admin อัปเดต status (in_progress | resolved | wontfix)
   * @param {number} reportId
   * @param {string} status
   * @param {number} resolvedBy   - user_id ของ Admin
   * @param {string|null} resolvedNote
   */
  static async updateStatus(reportId, status, resolvedBy, resolvedNote = null) {
    const resolvedAt = ['resolved', 'wontfix'].includes(status) ? new Date() : null;

    const [result] = await db.query(
      `UPDATE journal_watch.bug_reports
       SET status       = ?,
           resolved_by  = ?,
           resolved_note = ?,
           resolved_at  = ?
       WHERE report_id  = ?`,
      [status, resolvedBy, resolvedNote, resolvedAt, reportId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = BugReportModel;