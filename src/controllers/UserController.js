/**
 * UserController
 * จัดการ request/response สำหรับ user ทั่วไป (ดูและแก้ไขโปรไฟล์ตัวเอง)
 *
 * Endpoints:
 *   GET   /api/user/profile        → ดูโปรไฟล์ตัวเอง (ทุก role)
 *   PATCH /api/user/profile        → แก้ไขโปรไฟล์ตัวเอง (ทุก role)
 *                                    แก้ได้เฉพาะ: phone, facebook_id, line_id
 */
const db        = require('../config/database');
const UserModel = require('../models/UserModel');
const { serverError } = require('../utils/errorResponse');

class UserController {

  // ============================================================
  // GET /api/user/profile
  // Role: Student, Supervisor, Staff, Admin, SuperAdmin
  // ============================================================
  static async getProfile(req, res, next) {
    try {
      const userId = req.user.sub;

      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบข้อมูลผู้ใช้' });
      }

      // Base data — ทุก role
      const data = {
        userId:        user.user_id,
        role:          user.role,
        prefix:        user.prefix        || null,
        firstName:     user.first_name,
        lastName:      user.last_name,
        faculty:       user.faculty       || null,   
        department:    user.department     || null,  
        msuMail:       user.msu_mail,
        phone:         user.phone         || null,
        facebookId:    user.facebook_id   || null,
        lineId:        user.line_id       || null,
        accountStatus: user.account_status,
        lastLoginAt:   user.last_login_at || null,
      };

      // Admin / SuperAdmin — เพิ่ม username
      if (['Admin', 'SuperAdmin'].includes(user.role)) {
        data.username = user.username || null;
      }

      // Student — เพิ่ม degree info + advisors
      if (user.role === 'Student') {
        data.degreeLevel    = user.degree_level    || null;
        data.curriculumYear = user.curriculum_year || null;
        data.studyPlanCode  = user.study_plan_code || null;

        const advisorRows = await UserModel.findAdvisorsByStudentId(user.user_id);
        data.advisors = advisorRows.map(a => ({
          advisorType: a.advisor_type,
          userId:      a.user_id,
          prefix:      a.prefix    || null,
          firstName:   a.first_name,
          lastName:    a.last_name,
          msuMail:     a.msu_mail,
        }));
      }

      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  // ============================================================
  // PATCH /api/user/profile
  // Role: Student, Supervisor, Staff, Admin, SuperAdmin
  // Body: { phone?, facebook_id?, line_id? }
  //
  // แก้ได้เฉพาะ: phone, facebook_id, line_id
  // field อื่น (prefix, first_name, last_name, msu_mail, degree_level ฯลฯ)
  // ต้องติดต่อ Admin ผ่าน PATCH /api/admin/users/:id
  // ============================================================
  static async updateProfile(req, res, next) {
    try {
      const userId = req.user.sub;

      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบข้อมูลผู้ใช้' });
      }

      const { phone, facebook_id, line_id } = req.body;

      // Merge: ถ้า field ไม่ได้ส่งมา ใช้ค่าเดิม
      const merged = {
        phone:       phone       !== undefined ? phone       : user.phone,
        facebook_id: facebook_id !== undefined ? facebook_id : user.facebook_id,
        line_id:     line_id     !== undefined ? line_id     : user.line_id,
      };

      await db.query(
        `UPDATE journal_watch.users
            SET phone       = ?,
                facebook_id = ?,
                line_id     = ?
          WHERE user_id = ?`,
        [
          merged.phone       || null,
          merged.facebook_id || null,
          merged.line_id     || null,
          userId,
        ]
      );

      return res.json({
        success: true,
        message: 'แก้ไขข้อมูลติดต่อเรียบร้อยแล้ว',
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = UserController;