/**
 * PreT3Model
 * Data access layer สำหรับ table `journal_watch.pre_t3_requests`
 * ใช้ fully-qualified table name เพื่อหลีกเลี่ยงปัญหา session-level database
 */
const db = require('../config/database');

class PreT3Model {
  // ============================================================
  // CREATE
  // ============================================================

  /**
   * นิสิตยื่น Pre-T3 ใหม่
   * @param {number} studentId
   * @param {object} journalSnapshot  - issn, journal_name, journal_url, indexed_database, quartile_or_tier, is_discontinued, is_hijacked
   * @param {object} studentSnapshot  - degree_level, study_plan_code, curriculum_year
   * @param {object} checklistData    - item1–item9: true/false
   * @param {object} advisorIds       - majorAdvisorId, coAdvisor1Id (null), coAdvisor2Id (null)
   * @returns {number} pre_t3_id ที่สร้างใหม่
   */
  static async create(studentId, journalSnapshot, studentSnapshot, checklistData, advisorIds, studentInfo, advisorInfo, articleInfo) {
  const { majorAdvisorId, coAdvisor1Id = null, coAdvisor2Id = null } = advisorIds;

  const advisorApproval      = { status: 'Pending', user_id: majorAdvisorId, remark: null, approved_at: null };
  const co1Approval          = coAdvisor1Id
    ? { status: 'Pending', user_id: coAdvisor1Id, remark: null, approved_at: null }
    : { status: 'N/A',     user_id: null,          remark: null, approved_at: null };
  const co2Approval          = coAdvisor2Id
    ? { status: 'Pending', user_id: coAdvisor2Id, remark: null, approved_at: null }
    : { status: 'N/A',     user_id: null,          remark: null, approved_at: null };
  const programChairApproval = { status: 'N/A', user_id: null, remark: null, approved_at: null };
  const facultyComApproval   = { status: 'Pending', meeting_no: null, meeting_date: null, remark: null, approved_at: null };

  const [result] = await db.query(
    `INSERT INTO journal_watch.pre_t3_requests
       (student_id, journal_snapshot, student_snapshot, checklist_data,
        student_info, advisor_info, article_info,
        advisor_approval, co_advisor_1_approval, co_advisor_2_approval,
        program_chair_approval, faculty_com_approval, overall_status,
        resubmit_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 0)`,
    [
      studentId,
      JSON.stringify(journalSnapshot),
      JSON.stringify(studentSnapshot),
      JSON.stringify(checklistData),
      JSON.stringify(studentInfo),
      JSON.stringify(advisorInfo),
      JSON.stringify(articleInfo),
      JSON.stringify(advisorApproval),
      JSON.stringify(co1Approval),
      JSON.stringify(co2Approval),
      JSON.stringify(programChairApproval),
      JSON.stringify(facultyComApproval),
    ]
  );

  return result.insertId;
}

  // ============================================================
  // READ
  // ============================================================

  /**
   * ดึง Pre-T3 ตาม ID (พร้อมชื่อนิสิต)
   */
  static async findById(preT3Id) {
    const [rows] = await db.query(
      `SELECT p.*,
              u.first_name, u.last_name, u.msu_mail,
              u.degree_level AS user_degree_level
         FROM journal_watch.pre_t3_requests p
         JOIN journal_watch.users u ON u.user_id = p.student_id
        WHERE p.pre_t3_id = ?
        LIMIT 1`,
      [preT3Id]
    );
    return rows[0] || null;
  }

  /**
   * ดึง Pre-T3 ทั้งหมดของนิสิตคนนึง (เรียงใหม่สุดก่อน)
   */
  static async findByStudentId(studentId) {
    const [rows] = await db.query(
      `SELECT pre_t3_id, overall_status, resubmit_count, last_rejected_at,
              journal_snapshot, checklist_data,
              advisor_approval, faculty_com_approval,
              created_at, updated_at
         FROM journal_watch.pre_t3_requests
        WHERE student_id = ?
        ORDER BY created_at DESC`,
      [studentId]
    );
    return rows;
  }

  /**
   * ดึงรายการที่รอ Advisor คนนี้อนุมัติ
   * ตรวจทั้ง major advisor และ co_advisor_1/2
   */
  static async findPendingForAdvisor(advisorId) {
    const [rows] = await db.query(
      `SELECT p.pre_t3_id, p.overall_status,
              p.journal_snapshot, p.checklist_data,
              p.advisor_approval, p.co_advisor_1_approval, p.co_advisor_2_approval,
              p.faculty_com_approval, p.created_at,
              u.first_name, u.last_name, u.msu_mail
         FROM journal_watch.pre_t3_requests p
         JOIN journal_watch.users u ON u.user_id = p.student_id
        WHERE p.overall_status = 'Pending'
          AND (
            JSON_UNQUOTE(JSON_EXTRACT(p.advisor_approval,       '$.user_id')) = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(p.advisor_approval, '$.status'))  = 'Pending'
          OR
            JSON_UNQUOTE(JSON_EXTRACT(p.co_advisor_1_approval,  '$.user_id')) = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(p.co_advisor_1_approval, '$.status')) = 'Pending'
          OR
            JSON_UNQUOTE(JSON_EXTRACT(p.co_advisor_2_approval,  '$.user_id')) = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(p.co_advisor_2_approval, '$.status')) = 'Pending'
          )
        ORDER BY p.created_at ASC`,
      [advisorId, advisorId, advisorId]
    );
    return rows;
  }

  /**
   * ดึงรายการที่รอ Faculty Com อนุมัติ
   * (advisor_approval ทุกคนที่ required Approved หมดแล้ว และ faculty_com ยัง Pending)
   */
  static async findPendingForFaculty() {
    const [rows] = await db.query(
      `SELECT p.pre_t3_id, p.overall_status,
              p.journal_snapshot, p.checklist_data,
              p.advisor_approval, p.co_advisor_1_approval, p.co_advisor_2_approval,
              p.faculty_com_approval, p.created_at,
              u.first_name, u.last_name, u.msu_mail
         FROM journal_watch.pre_t3_requests p
         JOIN journal_watch.users u ON u.user_id = p.student_id
        WHERE p.overall_status = 'Pending'
          AND JSON_UNQUOTE(JSON_EXTRACT(p.advisor_approval,     '$.status')) = 'Approved'
          AND JSON_UNQUOTE(JSON_EXTRACT(p.faculty_com_approval, '$.status')) = 'Pending'
        ORDER BY p.created_at ASC`,
      []
    );
    return rows;
  }

  // ============================================================
  // UPDATE — Advisor Review
  // ============================================================

  /**
   * Advisor (major/co) อนุมัติหรือปฏิเสธ
   * ถ้า reject → overall_status = 'Rejected' ทันที
   * ถ้า approve ทุกคน → ส่งต่อ faculty_com
   */
  static async advisorReview(preT3Id, advisorId, action, remark) {
    const row = await PreT3Model.findById(preT3Id);
    if (!row) return null;

    const now = new Date().toISOString();
    let advisorApproval    = row.advisor_approval;
    let co1Approval        = row.co_advisor_1_approval;
    let co2Approval        = row.co_advisor_2_approval;
    const facultyApproval  = row.faculty_com_approval;

    // อัปเดต slot ที่ตรงกับ advisorId
    const applyReview = (slot) => {
      if (String(slot.user_id) === String(advisorId) && slot.status === 'Pending') {
        return { ...slot, status: action === 'approve' ? 'Approved' : 'Rejected', remark, approved_at: now };
      }
      return slot;
    };

    advisorApproval = applyReview(advisorApproval);
    co1Approval     = applyReview(co1Approval);
    co2Approval     = applyReview(co2Approval);

    // ตรวจว่ามีใคร Rejected ไหม → reject ทั้ง request
    const anyRejected = [advisorApproval, co1Approval, co2Approval]
      .some(s => s.status === 'Rejected');

    // ทุก slot ที่ไม่ใช่ N/A ต้อง Approved ทั้งหมด
    const allApproved = [advisorApproval, co1Approval, co2Approval]
      .filter(s => s.status !== 'N/A')
      .every(s => s.status === 'Approved');

    let newOverallStatus = row.overall_status;
    let lastRejectedAt   = row.last_rejected_at;

    if (anyRejected) {
      newOverallStatus = 'Rejected';
      lastRejectedAt   = now;
    }
    // ถ้า approve ครบ → overall ยังเป็น Pending รอ faculty_com (ไม่เปลี่ยน)
    // overall_status จะเปลี่ยนเป็น Approved ก็ต่อเมื่อ faculty_com approve

    await db.query(
      `UPDATE journal_watch.pre_t3_requests
          SET advisor_approval      = ?,
              co_advisor_1_approval = ?,
              co_advisor_2_approval = ?,
              overall_status        = ?,
              last_rejected_at      = ?
        WHERE pre_t3_id = ?`,
      [
        JSON.stringify(advisorApproval),
        JSON.stringify(co1Approval),
        JSON.stringify(co2Approval),
        newOverallStatus,
        lastRejectedAt,
        preT3Id,
      ]
    );

    return { anyRejected, allApproved, newOverallStatus };
  }

  // ============================================================
  // UPDATE — Faculty Com Review
  // ============================================================

  /**
   * Staff/Faculty Com อนุมัติหรือปฏิเสธขั้นสุดท้าย
   * @param {number} preT3Id
   * @param {string} action       - 'approve' | 'reject'
   * @param {string|null} meetingNo   - เฉพาะตอน approve
   * @param {string|null} meetingDate - เฉพาะตอน approve (YYYY-MM-DD)
   * @param {string|null} remark
   */
  static async facultyReview(preT3Id, action, meetingNo, meetingDate, remark) {
    const now    = new Date().toISOString();
    const status = action === 'approve' ? 'Approved' : 'Rejected';

    const facultyComApproval = {
      status,
      meeting_no:   meetingNo   || null,
      meeting_date: meetingDate || null,
      remark:       remark      || null,
      approved_at:  now,
    };

    const newOverallStatus = status; // Approved หรือ Rejected
    const lastRejectedAt   = status === 'Rejected' ? now : null;

    await db.query(
      `UPDATE journal_watch.pre_t3_requests
          SET faculty_com_approval = ?,
              overall_status       = ?,
              last_rejected_at     = COALESCE(?, last_rejected_at)
        WHERE pre_t3_id = ?`,
      [JSON.stringify(facultyComApproval), newOverallStatus, lastRejectedAt, preT3Id]
    );

    return { newOverallStatus };
  }

  // ============================================================
  // RESUBMIT (นิสิตยื่นซ้ำหลัง Rejected)
  // ============================================================

  /**
   * Reset request ให้กลับมา Pending อีกครั้ง (resubmit)
   * นิสิตแก้ไข checklist + journal แล้วยื่นใหม่
   */
  static async resubmit(preT3Id, journalSnapshot, checklistData, articleInfo) {
  const row = await PreT3Model.findById(preT3Id);
  if (!row) return null;

  const resetSlot = (slot) =>
    slot.status === 'N/A'
      ? slot
      : { ...slot, status: 'Pending', remark: null, approved_at: null };

  const advisorApproval      = resetSlot(row.advisor_approval);
  const co1Approval          = resetSlot(row.co_advisor_1_approval);
  const co2Approval          = resetSlot(row.co_advisor_2_approval);
  const facultyApproval      = { ...row.faculty_com_approval, status: 'Pending', meeting_no: null, meeting_date: null, remark: null, approved_at: null };
  const programChairApproval = row.program_chair_approval;

  await db.query(
    `UPDATE journal_watch.pre_t3_requests
        SET journal_snapshot      = ?,
            checklist_data        = ?,
            article_info          = ?,
            advisor_approval      = ?,
            co_advisor_1_approval = ?,
            co_advisor_2_approval = ?,
            faculty_com_approval  = ?,
            overall_status        = 'Pending',
            resubmit_count        = resubmit_count + 1
      WHERE pre_t3_id = ?
        AND overall_status = 'Rejected'`,
    [
      JSON.stringify(journalSnapshot),
      JSON.stringify(checklistData),
      JSON.stringify(articleInfo),
      JSON.stringify(advisorApproval),
      JSON.stringify(co1Approval),
      JSON.stringify(co2Approval),
      JSON.stringify(facultyApproval),
      preT3Id,
    ]
  );

  return true;
}

  // ============================================================
  // CANCEL (นิสิตยกเลิกคำขอของตัวเอง)
  // ============================================================

  /**
   * เปลี่ยน overall_status เป็น 'Cancelled'
   * ทำได้เฉพาะตอนสถานะ Pending หรือ Rejected เท่านั้น
   */
  static async cancel(preT3Id) {
    const [result] = await db.query(
      `UPDATE journal_watch.pre_t3_requests
          SET overall_status = 'Cancelled'
        WHERE pre_t3_id = ?
          AND overall_status IN ('Pending', 'Rejected')`,
      [preT3Id]
    );
    return result.affectedRows > 0;
  }
}

module.exports = PreT3Model;