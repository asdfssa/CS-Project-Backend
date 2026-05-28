const db = require('../config/database');

class SystemLogModel {
  static async log({ userId, action, targetType, targetId, detail, ipAddress, userAgent }) {
    try {
      await db.query(
        `INSERT INTO journal_watch.system_logs
            (user_id, action, target_type, target_id, detail, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          action,
          targetType || null,
          targetId || null,
          detail ? JSON.stringify(detail) : null,
          ipAddress,
          userAgent || null,
        ]
      );
    } catch (err) {
      console.error('Failed to write system log:', err.message);
    }
  }
}

module.exports = SystemLogModel;