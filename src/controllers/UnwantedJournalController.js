/**
 * UnwantedJournal Controller
 * Base path: /api/admin/unwanted-journals
 * เฉพาะ Admin, SuperAdmin, Staff
 */
const db = require('../config/database');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { serverError } = require('../utils/errorResponse');

class UnwantedJournalController {

  // ============================================================
  // GET /api/unwanted-journals/check/:issn
  // ตรวจสอบว่า ISSN อยู่ในรายการวารสารที่ไม่พึงประสงค์ของระบบหรือไม่
  // ทุก role ที่ login แล้วใช้ได้ (Student, Supervisor, Staff, Admin, SuperAdmin)
  // ============================================================
  static async checkByIssn(req, res, next) {
    try {
      const issn = req.params.issn?.trim();

      if (!issn) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุ ISSN' });
      }

      const [rows] = await db.query(
        `SELECT
          unwanted_id, issn, journal_name, publisher,
          note, recorded_date, created_at
         FROM journal_watch.msu_unwanted_journals
         WHERE issn = ? AND deleted_at IS NULL
         LIMIT 1`,
        [issn]
      );

      const found = rows.length > 0;

      return res.json({
        success: true,
        data: {
          isUnwanted: found,
          journal: found ? rows[0] : null,
        },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // GET /api/admin/unwanted-journals
  // Query: search, page, limit
  // ============================================================
  static async getAll(req, res, next) {
    try {
      const { search, page = 1, limit = 20 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      let where = ['uj.deleted_at IS NULL'];
      const params = [];

      if (search) {
        where.push('(journal_name LIKE ? OR issn LIKE ? OR publisher LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }

      const whereSQL = where.join(' AND ');

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total FROM journal_watch.msu_unwanted_journals uj WHERE ${whereSQL}`,
        params
      );

      const [rows] = await db.query(
        `SELECT
          uj.unwanted_id, uj.issn, uj.journal_name, uj.publisher,
          uj.note, uj.evidence_file_path, uj.recorded_date,
          uj.created_at,
          u.first_name, u.last_name, u.msu_mail
         FROM journal_watch.msu_unwanted_journals uj
         LEFT JOIN journal_watch.users u ON u.user_id = uj.created_by
         WHERE ${whereSQL}
         ORDER BY uj.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), offset]
      );

      return res.json({
        success: true,
        data: {
          journals: rows,
          pagination: {
            total: Number(countRows[0].total),
            page:  Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(Number(countRows[0].total) / Number(limit)),
          },
        },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // POST /api/admin/unwanted-journals/single
  // Body: { issn?, journal_name, publisher?, note?, recorded_date }
  // ============================================================
  static async createOne(req, res, next) {
    try {
      const { issn, journal_name, publisher, note, recorded_date } = req.body;

      if (!journal_name?.trim())
        return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อวารสาร' });
      if (!recorded_date)
        return res.status(400).json({ success: false, message: 'กรุณาระบุวันที่บันทึก' });

      // เช็คซ้ำด้วย issn (ถ้ามี)
      if (issn?.trim()) {
        const [dup] = await db.query(
          `SELECT unwanted_id FROM journal_watch.msu_unwanted_journals
           WHERE issn = ? AND deleted_at IS NULL`,
          [issn.trim()]
        );
        if (dup.length)
          return res.status(400).json({ success: false, message: `ISSN ${issn} มีอยู่ในรายการแล้ว` });
      }

      await db.query(
        `INSERT INTO journal_watch.msu_unwanted_journals
           (issn, journal_name, publisher, note, recorded_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          issn?.trim() || null,
          journal_name.trim(),
          publisher?.trim() || null,
          note?.trim() || null,
          recorded_date,
          req.user.sub,
        ]
      );

      return res.status(201).json({ success: true, message: 'เพิ่มวารสารเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // POST /api/admin/unwanted-journals/import
  // multipart/form-data: file = CSV
  // CSV columns: journal_name, issn, publisher, note, recorded_date
  // ============================================================
  static async importCsv(req, res, next) {
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }).single('file');

    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ success: false, message: 'อัปโหลดไฟล์ไม่สำเร็จ: ' + err.message });
      if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์ CSV' });

      try {
        let records;
        try {
          records = parse(req.file.buffer, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
          });
        } catch (parseErr) {
          return res.status(400).json({ success: false, message: 'ไฟล์ CSV ไม่ถูกต้อง: ' + parseErr.message });
        }

        if (!records.length)
          return res.status(400).json({ success: false, message: 'ไฟล์ CSV ว่างเปล่า' });

        const errors = [];

        for (let i = 0; i < records.length; i++) {
          const row = records[i];
          const rowNum = i + 2;

          if (!row.journal_name?.trim()) errors.push(`Row ${rowNum}: ไม่มี journal_name`);
          if (!row.recorded_date?.trim()) errors.push(`Row ${rowNum}: ไม่มี recorded_date`);

          // เช็คซ้ำใน DB
          if (row.issn?.trim()) {
            const [dup] = await db.query(
              `SELECT unwanted_id FROM journal_watch.msu_unwanted_journals
               WHERE issn = ? AND deleted_at IS NULL`,
              [row.issn.trim()]
            );
            if (dup.length) errors.push(`Row ${rowNum}: ISSN ${row.issn} มีอยู่ในรายการแล้ว`);
          }

          // เช็คซ้ำในไฟล์เดียวกัน
          if (row.issn?.trim()) {
            const dupInFile = records.filter((r, idx) =>
              idx !== i && r.issn?.trim() === row.issn.trim()
            );
            if (dupInFile.length) errors.push(`Row ${rowNum}: ISSN ${row.issn} ซ้ำในไฟล์`);
          }
        }

        if (errors.length) {
          return res.status(400).json({
            success: false,
            message: `พบ ${errors.length} ปัญหาใน CSV — ไม่มีข้อมูลถูก import`,
            errors,
          });
        }

        let imported = 0;
        for (const row of records) {
          await db.query(
            `INSERT INTO journal_watch.msu_unwanted_journals
               (issn, journal_name, publisher, note, recorded_date, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              row.issn?.trim() || null,
              row.journal_name.trim(),
              row.publisher?.trim() || null,
              row.note?.trim() || null,
              row.recorded_date.trim(),
              req.user.sub,
            ]
          );
          imported++;
        }

        return res.json({
          success: true,
          message: `Import สำเร็จ ${imported} รายการ`,
          data: { imported },
        });
      } catch (err) { next(err); }
    });
  }

  // ============================================================
  // PATCH /api/admin/unwanted-journals/:id
  // Body: { issn?, journal_name?, publisher?, note?, recorded_date? }
  // ============================================================
  static async updateOne(req, res, next) {
    try {
      const { id } = req.params;
      const [target] = await db.query(
        `SELECT * FROM journal_watch.msu_unwanted_journals
         WHERE unwanted_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบวารสาร' });

      const cur = target[0];
      const body = req.body;

      const merged = {
        issn:          body.issn          !== undefined ? body.issn?.trim() || null : cur.issn,
        journal_name:  body.journal_name  !== undefined ? body.journal_name.trim()  : cur.journal_name,
        publisher:     body.publisher     !== undefined ? body.publisher?.trim() || null : cur.publisher,
        note:          body.note          !== undefined ? body.note?.trim() || null : cur.note,
        recorded_date: body.recorded_date !== undefined ? body.recorded_date : cur.recorded_date,
      };

      if (!merged.journal_name)
        return res.status(400).json({ success: false, message: 'ชื่อวารสารห้ามว่าง' });

      await db.query(
        `UPDATE journal_watch.msu_unwanted_journals
         SET issn = ?, journal_name = ?, publisher = ?, note = ?, recorded_date = ?
         WHERE unwanted_id = ?`,
        [merged.issn, merged.journal_name, merged.publisher, merged.note, merged.recorded_date, id]
      );

      return res.json({ success: true, message: 'แก้ไขวารสารเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // DELETE /api/admin/unwanted-journals/:id  (soft delete)
  // ============================================================
  static async deleteOne(req, res, next) {
    try {
      const { id } = req.params;
      const [target] = await db.query(
        `SELECT unwanted_id FROM journal_watch.msu_unwanted_journals
         WHERE unwanted_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบวารสาร' });

      await db.query(
        `UPDATE journal_watch.msu_unwanted_journals
         SET deleted_at = NOW(), deleted_by = ?
         WHERE unwanted_id = ?`,
        [req.user.sub, id]
      );

      return res.json({ success: true, message: 'ลบวารสารเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }
}

module.exports = UnwantedJournalController;