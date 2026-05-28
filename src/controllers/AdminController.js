/**
 * Admin Controller
 * รับ HTTP request → เรียก DB โดยตรง → ส่ง response
 * เฉพาะ Admin และ SuperAdmin เท่านั้น
 */
const db = require('../config/database');

class AdminController {

  // ============================================================
  // GET /api/admin/stats
  // ============================================================
  static async getStats(req, res, next) {
    try {
      const [userRows] = await db.query(`
        SELECT
          COUNT(*)                                              AS total,
          SUM(role = 'Student')                                AS students,
          SUM(role = 'Supervisor')                             AS supervisors,
          SUM(role = 'Staff')                                  AS staff,
          SUM(role IN ('Admin','SuperAdmin'))                  AS admins,
          SUM(account_status = 'Pending')                     AS pending,
          SUM(account_status = 'Active')                      AS active,
          SUM(account_status = 'Suspended')                   AS suspended
        FROM journal_watch.users
        WHERE deleted_at IS NULL
      `);

      const [preT3Rows] = await db.query(`
        SELECT COUNT(*) AS total,
          SUM(overall_status = 'Pending')  AS pending,
          SUM(overall_status = 'Approved') AS approved,
          SUM(overall_status = 'Rejected') AS rejected
        FROM journal_watch.pre_t3_requests
      `);

      const [t3Rows] = await db.query(`
        SELECT COUNT(*) AS total,
          SUM(overall_status = 'Pending')  AS pending,
          SUM(overall_status = 'Approved') AS approved,
          SUM(overall_status = 'Rejected') AS rejected
        FROM journal_watch.t3_requests
      `);

      const [cacheRows] = await db.query(`
        SELECT COUNT(*) AS total,
          SUM(database_source = 'Scopus')   AS scopus,
          SUM(database_source = 'TCI')      AS tci,
          SUM(fetch_method = 'API')         AS via_api,
          SUM(fetch_method = 'Scraping')    AS via_scraping
        FROM journal_watch.journals_cache
      `);

      const [unwantedRows] = await db.query(`
        SELECT COUNT(*) AS total
        FROM journal_watch.msu_unwanted_journals
        WHERE deleted_at IS NULL
      `);

      let apiKeyStats = [];
      try {
        const scopusProxy = require('../services/ScopusProxyService');
        apiKeyStats = scopusProxy.getStatus();
      } catch (_) {}

      return res.json({
        success: true,
        data: {
          users: {
            total:       Number(userRows[0].total),
            students:    Number(userRows[0].students),
            supervisors: Number(userRows[0].supervisors),
            staff:       Number(userRows[0].staff),
            admins:      Number(userRows[0].admins),
            pending:     Number(userRows[0].pending),
            active:      Number(userRows[0].active),
            suspended:   Number(userRows[0].suspended),
          },
          pre_t3:  { total: Number(preT3Rows[0].total), pending: Number(preT3Rows[0].pending), approved: Number(preT3Rows[0].approved), rejected: Number(preT3Rows[0].rejected) },
          t3:      { total: Number(t3Rows[0].total),    pending: Number(t3Rows[0].pending),    approved: Number(t3Rows[0].approved),    rejected: Number(t3Rows[0].rejected) },
          journal_cache: { total: Number(cacheRows[0].total), scopus: Number(cacheRows[0].scopus), tci: Number(cacheRows[0].tci), via_api: Number(cacheRows[0].via_api), via_scraping: Number(cacheRows[0].via_scraping) },
          msu_unwanted: { total: Number(unwantedRows[0].total) },
          api_keys: apiKeyStats,
        },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // GET /api/admin/users
  // Query params: role, status, search, page, limit
  // ============================================================
  static async getUsers(req, res, next) {
    try {
      const { role, status, search, page = 1, limit = 20 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      let where = ['u.deleted_at IS NULL', "u.role NOT IN ('Admin','SuperAdmin')"];
      const params = [];

      if (role)   { where.push('u.role = ?');           params.push(role); }
      if (status) { where.push('u.account_status = ?'); params.push(status); }
      if (search) {
        where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.msu_mail LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }

      const whereSQL = where.join(' AND ');

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total FROM journal_watch.users u WHERE ${whereSQL}`,
        params
      );

const [rows] = await db.query(
        `SELECT
          u.user_id, u.prefix, u.first_name, u.last_name,
          u.msu_mail, u.role, u.degree_level, u.account_status,
          u.phone, u.facebook_id, u.line_id,
          u.curriculum_year, u.study_plan_code,
          u.created_at, u.last_login_at
         FROM journal_watch.users u
         WHERE ${whereSQL}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), offset]
      );

      // ดึง advisor ของ student แต่ละคน
      const studentIds = rows.filter(r => r.role === 'Student').map(r => r.user_id);
      let advisorMap = {};
      if (studentIds.length > 0) {
        const [advRows] = await db.query(
          `SELECT aa.student_id, aa.advisor_type,
                  u.msu_mail AS advisor_mail, u.first_name, u.last_name
           FROM journal_watch.advisor_assignments aa
           JOIN journal_watch.users u ON u.user_id = aa.advisor_id
           WHERE aa.student_id IN (?) AND aa.is_active = 1`,
          [studentIds]
        );
        for (const a of advRows) {
          if (!advisorMap[a.student_id]) advisorMap[a.student_id] = {};
          advisorMap[a.student_id][a.advisor_type] = {
            mail: a.advisor_mail,
            name: `${a.first_name} ${a.last_name}`,
          };
        }
      }

      const usersWithAdvisors = rows.map(u => ({
        ...u,
        advisors: advisorMap[u.user_id] || {},
      }));

      return res.json({
        success: true,
        data: {
          users: usersWithAdvisors,
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
  // PATCH /api/admin/users/:id/approve  (Pending → Active)
  // ============================================================
  static async approveUser(req, res, next) {
    try {
      const { id } = req.params;
      const [target] = await db.query(
        `SELECT user_id, account_status, role FROM journal_watch.users WHERE user_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (target[0].account_status !== 'Pending')
        return res.status(400).json({ success: false, message: 'สถานะต้องเป็น Pending เท่านั้น' });

      await db.query(
        `UPDATE journal_watch.users SET account_status = 'Active' WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'อนุมัติผู้ใช้เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/admin/users/:id/suspend
  // ============================================================
  static async suspendUser(req, res, next) {
    try {
      const { id } = req.params;
      if (Number(id) === req.user.userId)
        return res.status(400).json({ success: false, message: 'ไม่สามารถระงับบัญชีตัวเองได้' });

      const [target] = await db.query(
        `SELECT user_id, account_status, role FROM journal_watch.users WHERE user_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (['Admin','SuperAdmin'].includes(target[0].role))
        return res.status(403).json({ success: false, message: 'ไม่สามารถระงับ Admin ได้' });

      await db.query(
        `UPDATE journal_watch.users SET account_status = 'Suspended' WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'ระงับบัญชีเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/admin/users/:id/activate  (Suspended → Active)
  // ============================================================
  static async activateUser(req, res, next) {
    try {
      const { id } = req.params;
      const [target] = await db.query(
        `SELECT user_id, account_status FROM journal_watch.users WHERE user_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (target[0].account_status !== 'Suspended')
        return res.status(400).json({ success: false, message: 'สถานะต้องเป็น Suspended เท่านั้น' });

      await db.query(
        `UPDATE journal_watch.users SET account_status = 'Active' WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'คืนสถานะบัญชีเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/admin/users/:id  — แก้ไขข้อมูล
  // Body: { prefix, first_name, last_name, phone, degree_level }
  // ============================================================
  static async updateUser(req, res, next) {
    try {
      const { id } = req.params;

      // ดึงข้อมูลเดิมมาก่อน เพื่อทำ merge
      const [target] = await db.query(
        `SELECT user_id, prefix, first_name, last_name, msu_mail,
                phone, facebook_id, line_id,
                degree_level, curriculum_year, study_plan_code, role
         FROM journal_watch.users
         WHERE user_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      const current = target[0];
      const body = req.body;

      // Merge: ถ้า field นั้นไม่ได้ส่งมา ใช้ค่าเดิม
      const merged = {
        prefix:          body.prefix          !== undefined ? body.prefix          : current.prefix,
        first_name:      body.first_name      !== undefined ? body.first_name      : current.first_name,
        last_name:       body.last_name       !== undefined ? body.last_name       : current.last_name,
        msu_mail:        body.msu_mail        !== undefined ? body.msu_mail        : current.msu_mail,
        phone:           body.phone           !== undefined ? body.phone           : current.phone,
        facebook_id:     body.facebook_id     !== undefined ? body.facebook_id     : current.facebook_id,
        line_id:         body.line_id         !== undefined ? body.line_id         : current.line_id,
        degree_level:    body.degree_level    !== undefined ? body.degree_level    : current.degree_level,
        curriculum_year: body.curriculum_year !== undefined ? body.curriculum_year : current.curriculum_year,
        study_plan_code: body.study_plan_code !== undefined ? body.study_plan_code : current.study_plan_code,
      };

      // Validate required fields
      if (!merged.first_name?.trim()) return res.status(400).json({ success: false, message: 'ชื่อห้ามว่าง' });
      if (!merged.last_name?.trim())  return res.status(400).json({ success: false, message: 'นามสกุลห้ามว่าง' });
      if (!merged.msu_mail?.trim())   return res.status(400).json({ success: false, message: 'อีเมลห้ามว่าง' });

      // degree_level/curriculum_year/study_plan_code เฉพาะนิสิต
      if (!['Student'].includes(current.role)) {
        merged.degree_level    = null;
        merged.curriculum_year = null;
        merged.study_plan_code = null;
      }

      await db.query(
        `UPDATE journal_watch.users SET
          prefix = ?, first_name = ?, last_name = ?, msu_mail = ?,
          phone = ?, facebook_id = ?, line_id = ?,
          degree_level = ?, curriculum_year = ?, study_plan_code = ?
         WHERE user_id = ?`,
        [
          merged.prefix || null,
          merged.first_name,
          merged.last_name,
          merged.msu_mail,
          merged.phone || null,
          merged.facebook_id || null,
          merged.line_id || null,
          merged.degree_level || null,
          merged.curriculum_year || null,
          merged.study_plan_code || null,
          id,
        ]
      );

      return res.json({ success: true, message: 'แก้ไขข้อมูลเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }
  
// ============================================================
  // POST /api/admin/users/single — เพิ่ม user ทีละคน
  // Body: { role, first_name, last_name, msu_mail, prefix?,
  //         phone?, degree_level?, curriculum_year?,
  //         study_plan_code?, advisor_major_mail?, advisor_co1_mail? }
  // ============================================================
  static async createUser(req, res, next) {
    try {
      const {
        role, first_name, last_name, msu_mail, prefix,
        phone, degree_level, curriculum_year, study_plan_code,
        advisor_major_mail, advisor_co1_mail,
      } = req.body;

      // ===== Validate required =====
      if (!role)       return res.status(400).json({ success: false, message: 'กรุณาระบุ Role' });
      if (!first_name) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อ' });
      if (!last_name)  return res.status(400).json({ success: false, message: 'กรุณาระบุนามสกุล' });
      if (!msu_mail)   return res.status(400).json({ success: false, message: 'กรุณาระบุ MSU Mail' });

      const allowedRoles = ['Student', 'Supervisor', 'Program_Chair'];
      if (!allowedRoles.includes(role))
        return res.status(400).json({ success: false, message: `Role ต้องเป็น ${allowedRoles.join(', ')}` });

      const mailLower = msu_mail.toLowerCase().trim();

      // ===== เช็ก msu_mail ซ้ำ =====
      const [existing] = await db.query(
        `SELECT user_id FROM journal_watch.users WHERE msu_mail = ? AND deleted_at IS NULL`,
        [mailLower]
      );
      if (existing.length)
        return res.status(400).json({ success: false, message: `MSU Mail ${mailLower} มีอยู่ในระบบแล้ว` });

      // ===== เช็ก advisor (เฉพาะ Student) =====
      let advisorMajorId = null;
      let advisorCo1Id   = null;

if (role === 'Student') {
        // advisor เป็น optional — ไม่บังคับ
        if (advisor_major_mail) {
          const [majRows] = await db.query(
            `SELECT user_id FROM journal_watch.users
             WHERE msu_mail = ? AND role = 'Supervisor' AND deleted_at IS NULL`,
            [advisor_major_mail.toLowerCase().trim()]
          );
          if (!majRows.length)
            return res.status(400).json({ success: false, message: `ไม่พบอาจารย์ที่ปรึกษาหลัก: ${advisor_major_mail}` });
          advisorMajorId = majRows[0].user_id;
        }

        if (advisor_co1_mail) {
          const [co1Rows] = await db.query(
            `SELECT user_id FROM journal_watch.users
             WHERE msu_mail = ? AND role = 'Supervisor' AND deleted_at IS NULL`,
            [advisor_co1_mail.toLowerCase().trim()]
          );
          if (!co1Rows.length)
            return res.status(400).json({ success: false, message: `ไม่พบอาจารย์ที่ปรึกษาร่วม: ${advisor_co1_mail}` });
          advisorCo1Id = co1Rows[0].user_id;
        }
      }

      // ===== Insert user =====
      const [result] = await db.query(
        `INSERT INTO journal_watch.users
           (msu_mail, oauth_provider, oauth_provider_id,
            role, prefix, first_name, last_name,
            phone, degree_level, curriculum_year, study_plan_code,
            account_status)
         VALUES (?, 'google', UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
        [
          mailLower, role,
          prefix || null, first_name.trim(), last_name.trim(),
          phone || null,
          degree_level || null, curriculum_year || null, study_plan_code || null,
        ]
      );
      const newUserId = result.insertId;

      // ===== Insert advisor_assignments =====
      if (advisorMajorId) {
        await db.query(
          `INSERT INTO journal_watch.advisor_assignments
             (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Major')`,
          [newUserId, advisorMajorId]
        );
      }
      if (advisorCo1Id) {
        await db.query(
          `INSERT INTO journal_watch.advisor_assignments
             (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Co_1')`,
          [newUserId, advisorCo1Id]
        );
      }

      return res.status(201).json({
        success: true,
        message: `เพิ่ม ${role} ${first_name} ${last_name} เรียบร้อยแล้ว`,
        data: { user_id: newUserId },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // POST /api/admin/users/import — import CSV
  // multipart/form-data: file = CSV file
  // ============================================================
  static async importUsers(req, res, next) {
    const multer  = require('multer');
    const { parse } = require('csv-parse/sync');

    // รับไฟล์ใน memory
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }).single('file');

    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ success: false, message: 'อัปโหลดไฟล์ไม่สำเร็จ: ' + err.message });
      if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์ CSV' });

      try {
        // ===== Parse CSV =====
        let records;
        try {
records = parse(req.file.buffer, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
            encoding: 'utf8',
          });
        } catch (parseErr) {
          return res.status(400).json({ success: false, message: 'ไฟล์ CSV ไม่ถูกต้อง: ' + parseErr.message });
        }

        if (!records.length)
          return res.status(400).json({ success: false, message: 'ไฟล์ CSV ว่างเปล่า' });

        const errors = [];

        // ===== Validate ทุก row ก่อน (all-or-nothing) =====
        for (let i = 0; i < records.length; i++) {
          const row = records[i];
          const rowNum = i + 2; // +2 เพราะ row 1 = header

          // required fields
          if (!row.role)       errors.push(`Row ${rowNum}: ไม่มี role`);
          if (!row.first_name) errors.push(`Row ${rowNum}: ไม่มี first_name`);
          if (!row.last_name)  errors.push(`Row ${rowNum}: ไม่มี last_name`);
          if (!row.msu_mail)   errors.push(`Row ${rowNum}: ไม่มี msu_mail`);

          const allowedRoles = ['Student', 'Supervisor', 'Program_Chair'];
          if (row.role && !allowedRoles.includes(row.role))
            errors.push(`Row ${rowNum}: role "${row.role}" ไม่ถูกต้อง`);

          if (row.msu_mail) {
            // เช็กซ้ำในระบบ
            const [dup] = await db.query(
              `SELECT user_id FROM journal_watch.users WHERE msu_mail = ? AND deleted_at IS NULL`,
              [row.msu_mail.toLowerCase().trim()]
            );
            if (dup.length) errors.push(`Row ${rowNum}: MSU Mail ${row.msu_mail} มีอยู่ในระบบแล้ว`);

            // เช็กซ้ำในไฟล์เดียวกัน
            const dupInFile = records.filter((r, idx) =>
              idx !== i && r.msu_mail?.toLowerCase().trim() === row.msu_mail.toLowerCase().trim()
            );
            if (dupInFile.length) errors.push(`Row ${rowNum}: MSU Mail ${row.msu_mail} ซ้ำในไฟล์`);
          }

          // เช็ก advisor เฉพาะ Student (optional)
          if (row.role === 'Student') {
            if (row.advisor_major_mail) {
              const [maj] = await db.query(
                `SELECT user_id FROM journal_watch.users
                 WHERE msu_mail = ? AND role = 'Supervisor' AND deleted_at IS NULL`,
                [row.advisor_major_mail.toLowerCase().trim()]
              );
              if (!maj.length)
                errors.push(`Row ${rowNum}: ไม่พบอาจารย์ที่ปรึกษาหลัก "${row.advisor_major_mail}" ในระบบ`);
            }

            if (row.advisor_co1_mail) {
              const [co1] = await db.query(
                `SELECT user_id FROM journal_watch.users
                 WHERE msu_mail = ? AND role = 'Supervisor' AND deleted_at IS NULL`,
                [row.advisor_co1_mail.toLowerCase().trim()]
              );
              if (!co1.length)
                errors.push(`Row ${rowNum}: ไม่พบอาจารย์ที่ปรึกษาร่วม "${row.advisor_co1_mail}" ในระบบ`);
            }
          }
        }

        // ===== ถ้ามี error หยุดทันที =====
        if (errors.length) {
          return res.status(400).json({
            success: false,
            message: `พบ ${errors.length} ปัญหาใน CSV — ไม่มีข้อมูลถูก import`,
            errors,
          });
        }

        // ===== ผ่านทั้งหมด → Insert =====
        let imported = 0;
        for (const row of records) {
          const mailLower = row.msu_mail.toLowerCase().trim();

          const [result] = await db.query(
            `INSERT INTO journal_watch.users
               (msu_mail, oauth_provider, oauth_provider_id,
                role, prefix, first_name, last_name,
                phone, degree_level, curriculum_year, study_plan_code,
                account_status)
             VALUES (?, 'google', UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
            [
              mailLower, row.role,
              row.prefix || null, row.first_name.trim(), row.last_name.trim(),
              row.phone || null,
              row.degree_level || null, row.curriculum_year || null, row.study_plan_code || null,
            ]
          );
          const newUserId = result.insertId;

          // advisor_assignments
          if (row.role === 'Student' && row.advisor_major_mail) {
            const [maj] = await db.query(
              `SELECT user_id FROM journal_watch.users WHERE msu_mail = ? AND deleted_at IS NULL`,
              [row.advisor_major_mail.toLowerCase().trim()]
            );
            if (maj.length) {
              await db.query(
                `INSERT INTO journal_watch.advisor_assignments
                   (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Major')`,
                [newUserId, maj[0].user_id]
              );
            }

            if (row.advisor_co1_mail) {
              const [co1] = await db.query(
                `SELECT user_id FROM journal_watch.users WHERE msu_mail = ? AND deleted_at IS NULL`,
                [row.advisor_co1_mail.toLowerCase().trim()]
              );
              if (co1.length) {
                await db.query(
                  `INSERT INTO journal_watch.advisor_assignments
                     (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Co_1')`,
                  [newUserId, co1[0].user_id]
                );
              }
            }
          }

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
  // PATCH /api/admin/users/:id/advisors
  // Body: { advisor_major_mail?, advisor_co1_mail?, advisor_co2_mail? }
  // ============================================================
  static async updateAdvisors(req, res, next) {
    try {
      const { id } = req.params;
      const { advisor_major_mail, advisor_co1_mail, advisor_co2_mail } = req.body;

      // เช็กว่า student มีอยู่จริง
      const [target] = await db.query(
        `SELECT user_id, role FROM journal_watch.users WHERE user_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
      if (target[0].role !== 'Student')
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่นิสิต' });

      // helper: lookup advisor by mail
      const lookupAdvisor = async (mail) => {
        if (!mail || !mail.trim()) return null;
        const [rows] = await db.query(
          `SELECT user_id FROM journal_watch.users
           WHERE msu_mail = ? AND role = 'Supervisor' AND deleted_at IS NULL`,
          [mail.toLowerCase().trim()]
        );
        if (!rows.length) throw new Error(`ไม่พบอาจารย์ที่ปรึกษา: ${mail}`);
        return rows[0].user_id;
      };

      let majorId, co1Id, co2Id;
      try {
        majorId = await lookupAdvisor(advisor_major_mail);
        co1Id   = await lookupAdvisor(advisor_co1_mail);
        co2Id   = await lookupAdvisor(advisor_co2_mail);
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }

      // ลบ assignments เดิมทั้งหมดของนิสิตคนนี้
      await db.query(
        `DELETE FROM journal_watch.advisor_assignments WHERE student_id = ?`,
        [id]
      );

      // insert ใหม่
      if (majorId) {
        await db.query(
          `INSERT INTO journal_watch.advisor_assignments (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Major')`,
          [id, majorId]
        );
      }
      if (co1Id) {
        await db.query(
          `INSERT INTO journal_watch.advisor_assignments (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Co_1')`,
          [id, co1Id]
        );
      }
      if (co2Id) {
        await db.query(
          `INSERT INTO journal_watch.advisor_assignments (student_id, advisor_id, advisor_type) VALUES (?, ?, 'Co_2')`,
          [id, co2Id]
        );
      }

      return res.json({ success: true, message: 'อัปเดตอาจารย์ที่ปรึกษาเรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // GET /api/admin/logs
  // Query params: user_id, action, target_type, target_id,
  //               date_from, date_to, page, limit
  // ============================================================
  static async getLogs(req, res, next) {
    try {
      const {
        user_id, action, target_type, target_id,
        date_from, date_to,
        page = 1, limit = 50,
      } = req.query;

      const offset = (Number(page) - 1) * Number(limit);

      let where = [];
      const params = [];

      if (user_id)     { where.push('sl.user_id = ?');      params.push(user_id); }
      if (action)      { where.push('sl.action LIKE ?');     params.push(`%${action}%`); }
      if (target_type) { where.push('sl.target_type = ?');   params.push(target_type); }
      if (target_id)   { where.push('sl.target_id = ?');     params.push(target_id); }
      if (date_from)   { where.push('sl.created_at >= ?');   params.push(date_from); }
      if (date_to)     { where.push('sl.created_at <= ?');   params.push(date_to); }

      const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS total FROM journal_watch.system_logs sl ${whereSQL}`,
        params
      );

      const [rows] = await db.query(
        `SELECT
          sl.log_id, sl.user_id,
          u.first_name, u.last_name, u.msu_mail, u.role,
          sl.action, sl.target_type, sl.target_id,
          sl.detail, sl.ip_address, sl.user_agent,
          sl.created_at
         FROM journal_watch.system_logs sl
         LEFT JOIN journal_watch.users u ON u.user_id = sl.user_id
         ${whereSQL}
         ORDER BY sl.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), offset]
      );

      return res.json({
        success: true,
        data: {
          logs: rows,
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
  // POST /api/admin/admins
  // สร้าง Admin ใหม่ (username + password)
  // Body: { username, password, first_name, last_name, msu_mail }
  // เฉพาะ Admin และ SuperAdmin
  // ============================================================
  static async createAdmin(req, res, next) {
    try {
      const { username, password, first_name, last_name, msu_mail } = req.body;

      if (!username?.trim())   return res.status(400).json({ success: false, message: 'กรุณาระบุ username' });
      if (!password?.trim())   return res.status(400).json({ success: false, message: 'กรุณาระบุ password' });
      if (!first_name?.trim()) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อ' });
      if (!last_name?.trim())  return res.status(400).json({ success: false, message: 'กรุณาระบุนามสกุล' });
      if (!msu_mail?.trim())   return res.status(400).json({ success: false, message: 'กรุณาระบุอีเมล' });

      // เช็ค username ซ้ำ
      const [dupUser] = await db.query(
        `SELECT user_id FROM journal_watch.users WHERE username = ? AND deleted_at IS NULL`,
        [username.trim().toLowerCase()]
      );
      if (dupUser.length)
        return res.status(400).json({ success: false, message: `Username "${username}" มีอยู่ในระบบแล้ว` });

      // เช็ค msu_mail ซ้ำ
      const [dupMail] = await db.query(
        `SELECT user_id FROM journal_watch.users WHERE msu_mail = ? AND deleted_at IS NULL`,
        [msu_mail.trim().toLowerCase()]
      );
      if (dupMail.length)
        return res.status(400).json({ success: false, message: `Email "${msu_mail}" มีอยู่ในระบบแล้ว` });

      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(password, 12);

      const [result] = await db.query(
        `INSERT INTO journal_watch.users
           (username, password_hash, msu_mail, role,
            first_name, last_name, account_status)
         VALUES (?, ?, ?, 'Admin', ?, ?, 'Active')`,
        [
          username.trim().toLowerCase(),
          passwordHash,
          msu_mail.trim().toLowerCase(),
          first_name.trim(),
          last_name.trim(),
        ]
      );

      return res.status(201).json({
        success: true,
        message: `สร้าง Admin "${username}" เรียบร้อยแล้ว`,
        data: { user_id: result.insertId },
      });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/admin/admins/:id/suspend  (Admin → Suspended)
  // Admin และ SuperAdmin ทำได้ แต่แตะ SuperAdmin ไม่ได้
  // ============================================================
  static async suspendAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerId   = req.user.sub;
      const callerRole = req.user.role;

      if (Number(id) === callerId)
        return res.status(400).json({ success: false, message: 'ไม่สามารถระงับบัญชีตัวเองได้' });

      const [target] = await db.query(
        `SELECT user_id, role, account_status FROM journal_watch.users
         WHERE user_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      // Admin แตะ SuperAdmin ไม่ได้
      if (callerRole === 'Admin' && target[0].role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถระงับ SuperAdmin ได้' });

      if (!['Admin', 'SuperAdmin'].includes(target[0].role))
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      await db.query(
        `UPDATE journal_watch.users SET account_status = 'Suspended' WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'ระงับบัญชี Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/admin/admins/:id/activate  (Suspended → Active)
  // ============================================================
  static async activateAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerRole = req.user.role;

      const [target] = await db.query(
        `SELECT user_id, role, account_status FROM journal_watch.users
         WHERE user_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      if (callerRole === 'Admin' && target[0].role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถแก้ไข SuperAdmin ได้' });

      if (!['Admin', 'SuperAdmin'].includes(target[0].role))
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      await db.query(
        `UPDATE journal_watch.users SET account_status = 'Active' WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'คืนสถานะ Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // PATCH /api/admin/admins/:id  — แก้ไขข้อมูล Admin
  // Body: { first_name?, last_name?, msu_mail? }
  // ============================================================
  static async updateAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerRole = req.user.role;

      const [target] = await db.query(
        `SELECT user_id, role, first_name, last_name, msu_mail
         FROM journal_watch.users
         WHERE user_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      if (callerRole === 'Admin' && target[0].role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถแก้ไข SuperAdmin ได้' });

      if (!['Admin', 'SuperAdmin'].includes(target[0].role))
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      const cur  = target[0];
      const body = req.body;

      const merged = {
        first_name: body.first_name !== undefined ? body.first_name.trim() : cur.first_name,
        last_name:  body.last_name  !== undefined ? body.last_name.trim()  : cur.last_name,
        msu_mail:   body.msu_mail   !== undefined ? body.msu_mail.trim().toLowerCase() : cur.msu_mail,
      };

      if (!merged.first_name) return res.status(400).json({ success: false, message: 'ชื่อห้ามว่าง' });
      if (!merged.last_name)  return res.status(400).json({ success: false, message: 'นามสกุลห้ามว่าง' });
      if (!merged.msu_mail)   return res.status(400).json({ success: false, message: 'อีเมลห้ามว่าง' });

      await db.query(
        `UPDATE journal_watch.users
         SET first_name = ?, last_name = ?, msu_mail = ?
         WHERE user_id = ?`,
        [merged.first_name, merged.last_name, merged.msu_mail, id]
      );

      return res.json({ success: true, message: 'แก้ไขข้อมูล Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  // ============================================================
  // DELETE /api/admin/admins/:id  (hard delete — SuperAdmin only)
  // ============================================================
  static async deleteAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const callerId   = req.user.sub;
      const callerRole = req.user.role;

      // เฉพาะ SuperAdmin เท่านั้น
      if (callerRole !== 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'เฉพาะ SuperAdmin เท่านั้นที่ลบ Admin ได้' });

      if (Number(id) === callerId)
        return res.status(400).json({ success: false, message: 'ไม่สามารถลบบัญชีตัวเองได้' });

      const [target] = await db.query(
        `SELECT user_id, role FROM journal_watch.users
         WHERE user_id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!target.length)
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });

      if (target[0].role === 'SuperAdmin')
        return res.status(403).json({ success: false, message: 'ไม่สามารถลบ SuperAdmin ได้' });

      if (target[0].role !== 'Admin')
        return res.status(400).json({ success: false, message: 'ผู้ใช้นี้ไม่ใช่ Admin' });

      await db.query(
        `UPDATE journal_watch.users SET deleted_at = NOW() WHERE user_id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'ลบ Admin เรียบร้อยแล้ว' });
    } catch (err) { next(err); }
  }

  
}

module.exports = AdminController;