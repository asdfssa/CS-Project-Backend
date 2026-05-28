/**
 * RefreshTokenModel
 * จัดการ refresh_tokens table
 */
const db = require('../config/database');

class RefreshTokenModel {

  /**
   * บันทึก refresh token ใหม่ลง DB
   */
  static async create({ userId, tokenHash, expiresAt, ipAddress, userAgent }) {
    const [result] = await db.query(
      `INSERT INTO journal_watch.refresh_tokens
        (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, tokenHash, expiresAt, ipAddress || null, userAgent || null]
    );
    return result.insertId;
  }

  /**
   * หา token จาก hash — ใช้ตอน verify refresh
   */
  static async findByHash(tokenHash) {
    const [rows] = await db.query(
      `SELECT * FROM journal_watch.refresh_tokens
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    return rows[0] || null;
  }

  /**
   * Revoke token เดียว (logout)
   */
  static async revokeByHash(tokenHash) {
    await db.query(
      `UPDATE journal_watch.refresh_tokens
       SET revoked_at = NOW()
       WHERE token_hash = ?`,
      [tokenHash]
    );
  }

  /**
   * Revoke ทุก token ของ user (logout all devices)
   */
  static async revokeAllByUserId(userId) {
    await db.query(
      `UPDATE journal_watch.refresh_tokens
       SET revoked_at = NOW()
       WHERE user_id = ? AND revoked_at IS NULL`,
      [userId]
    );
  }

  /**
   * ลบ token ที่หมดอายุแล้วออก (cleanup)
   */
  static async deleteExpired() {
    const [result] = await db.query(
      `DELETE FROM journal_watch.refresh_tokens
       WHERE expires_at < NOW()`
    );
    return result.affectedRows;
  }
}

module.exports = RefreshTokenModel;