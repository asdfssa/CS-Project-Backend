/**
 * User Model
 * Data access layer สำหรับ table `journal_watch.users`
 * ใช้ fully-qualified table name เพื่อหลีกเลี่ยงปัญหา session-level database
 */
const db = require('../config/database');

class UserModel {
  static async findByUsername(username) {
    const [rows] = await db.query(
      `SELECT user_id, username, password_hash, msu_mail, role, first_name, last_name,
              account_status, failed_login_attempts, locked_until, deleted_at
         FROM journal_watch.users
        WHERE username = ?
          AND deleted_at IS NULL
        LIMIT 1`,
      [username.toLowerCase()]
    );
    return rows[0] || null;
  }

static async findById(userId) {
  const [rows] = await db.query(
    `SELECT user_id, username, msu_mail, role, prefix,
            first_name, last_name, faculty, department,   
            degree_level, study_plan_code, curriculum_year,
            phone, facebook_id, line_id,
            account_status, last_login_at
       FROM journal_watch.users
      WHERE user_id = ?
        AND deleted_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}
  static async findByMsuMail(msuMail) {
    const [rows] = await db.query(
      `SELECT user_id, username, msu_mail, oauth_provider, oauth_provider_id,
              role, first_name, last_name,
              account_status, failed_login_attempts, locked_until, deleted_at
         FROM journal_watch.users
        WHERE msu_mail = ?
          AND deleted_at IS NULL
        LIMIT 1`,
      [msuMail.toLowerCase()]
    );
    return rows[0] || null;
  }

  static async incrementFailedAttempts(userId, maxAttempts, lockoutMinutes) {
    await db.query(
      `UPDATE journal_watch.users
          SET failed_login_attempts = failed_login_attempts + 1,
              locked_until = CASE
                WHEN failed_login_attempts + 1 >= ?
                THEN DATE_ADD(NOW(), INTERVAL ? MINUTE)
                ELSE locked_until
              END
        WHERE user_id = ?`,
      [maxAttempts, lockoutMinutes, userId]
    );
  }

  static async resetFailedAttempts(userId, ipAddress) {
    await db.query(
      `UPDATE journal_watch.users
          SET failed_login_attempts = 0,
              locked_until = NULL,
              last_login_at = NOW(),
              last_login_ip = ?
        WHERE user_id = ?`,
      [ipAddress, userId]
    );
  }

  static isLocked(user) {
    if (!user.locked_until) return false;
    return new Date(user.locked_until) > new Date();
  }

  static async updatePassword(userId, passwordHash) {
    await db.query(
      `UPDATE journal_watch.users SET password_hash = ?, updated_at = NOW() WHERE user_id = ?`,
      [passwordHash, userId]
    );
  }

  static async findAdvisorsByStudentId(studentId) {
  const [rows] = await db.query(
    `SELECT aa.advisor_type,
            u.user_id, u.prefix, u.first_name, u.last_name,
            u.msu_mail, u.role
       FROM journal_watch.advisor_assignments aa
       JOIN journal_watch.users u ON u.user_id = aa.advisor_id
      WHERE aa.student_id = ?
        AND aa.is_active = TRUE
        AND u.deleted_at IS NULL
      ORDER BY FIELD(aa.advisor_type, 'Major', 'Co_1', 'Co_2')`,
    [studentId]
  );
  return rows;
}

}

module.exports = UserModel;