/**
 * T3Model
 * Data access layer สำหรับ table `journal_watch.t3_requests`
 * ใช้ fully-qualified table name เพื่อหลีกเลี่ยงปัญหา session-level database
 */
const db = require('../config/database');

class T3Model {
  // ============================================================
  // CREATE
  // ============================================================

  /**
   * นิสิตยื่น T3 ใหม่
   * @param {number} studentId
   * @param {number} preT3Id               - ต้องมี Pre-T3 Approved ก่อน
   * @param {string} issn
   * @param {object} journalSnapshot       - issn, journal_name
   * @param {object} studentSnapshot       - degree_level, study_plan_code, curriculum_year
   * @param {object} paperAndResearchDetails - title_thai, title_english, first_author, corresponding_author, innovation_type, innovation_detail
   * @param {object} publicationDetails    - type, weight_score, specified_database, status, volume, issue, publish_year
   * @param {object} journalMetrics        - has_impact_score, impact_factor, citescore, score_year
   * @param {object} advisorIds            - majorAdvisorId, coAdvisor1Id, coAdvisor2Id
   * @returns {number} t3_id ที่สร้างใหม่
   */
  static async create(
    studentId,
    preT3Id,
    issn,
    journalSnapshot,
    studentSnapshot,
    paperAndResearchDetails,
    publicationDetails,
    journalMetrics,
    advisorIds
  ) {
    const { majorAdvisorId, coAdvisor1Id = null, coAdvisor2Id = null } = advisorIds;

    const advisorApproval = { status: 'Pending', user_id: majorAdvisorId, remark: null, approved_at: null };
    const co1Approval     = coAdvisor1Id
      ? { status: 'Pending', user_id: coAdvisor1Id, remark: null, approved_at: null }
      : { status: 'N/A',     user_id: null,          remark: null, approved_at: null };
    const co2Approval     = coAdvisor2Id
      ? { status: 'Pending', user_id: coAdvisor2Id, remark: null, approved_at: null }
      : { status: 'N/A',     user_id: null,          remark: null, approved_at: null };

    const facultyComApproval = {
      status:       'Pending',
      meeting_no:   null,
      meeting_date: null,
      remark:       null,
      approved_at:  null,
    };

    // Grad School อนุมัติผ่านอีเมลภายนอก Faculty Com เป็นคนไปยื่นเอง
    const gradSchoolApproval = {
      status:             'Pending',
      remark:             null,
      approved_by_email:  null,
      approved_at:        null,
    };

    // evidence files เริ่มต้นเป็น null ทั้งหมด จะ upload แยก
    const journalEvidenceFiles = {
      acceptance_letter_path:  null,
      full_paper_path:         null,
      journal_cover_path:      null,
      table_of_contents_path:  null,
      database_evidence_path:  null,
      peer_review_result_path: null,
    };

    const [result] = await db.query(
      `INSERT INTO journal_watch.t3_requests
         (pre_t3_id, student_id, issn,
          journal_snapshot, student_snapshot,
          paper_and_research_details, publication_details,
          journal_metrics, journal_evidence_files,
          advisor_approval, co_advisor_1_approval, co_advisor_2_approval,
          faculty_com_approval, grad_school_approval,
          overall_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
      [
        preT3Id,
        studentId,
        issn,
        JSON.stringify(journalSnapshot),
        JSON.stringify(studentSnapshot),
        JSON.stringify(paperAndResearchDetails),
        JSON.stringify(publicationDetails),
        JSON.stringify(journalMetrics),
        JSON.stringify(journalEvidenceFiles),
        JSON.stringify(advisorApproval),
        JSON.stringify(co1Approval),
        JSON.stringify(co2Approval),
        JSON.stringify(facultyComApproval),
        JSON.stringify(gradSchoolApproval),
      ]
    );

    return result.insertId;
  }

  // ============================================================
  // READ
  // ============================================================

  /**
   * ดึง T3 ตาม ID (พร้อมชื่อนิสิต)
   */
  static async findById(t3Id) {
    const [rows] = await db.query(
      `SELECT t.*,
              u.first_name, u.last_name, u.msu_mail
         FROM journal_watch.t3_requests t
         JOIN journal_watch.users u ON u.user_id = t.student_id
        WHERE t.t3_id = ?
        LIMIT 1`,
      [t3Id]
    );
    return rows[0] || null;
  }

  /**
   * ดึง T3 ทั้งหมดของนิสิตคนนึง (เรียงใหม่สุดก่อน)
   */
  static async findByStudentId(studentId) {
    const [rows] = await db.query(
      `SELECT t3_id, pre_t3_id, issn, overall_status,
              journal_snapshot, paper_and_research_details,
              publication_details, journal_metrics,
              advisor_approval, faculty_com_approval, grad_school_approval,
              submission_date, submission_round_cutoff,
              created_at, updated_at
         FROM journal_watch.t3_requests
        WHERE student_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [studentId]
    );
    return rows;
  }

  /**
   * ดึงรายการที่รอ Advisor คนนี้อนุมัติ
   */
  static async findPendingForAdvisor(advisorId) {
    const [rows] = await db.query(
      `SELECT t.t3_id, t.pre_t3_id, t.overall_status,
              t.journal_snapshot, t.paper_and_research_details, t.publication_details,
              t.advisor_approval, t.co_advisor_1_approval, t.co_advisor_2_approval,
              t.faculty_com_approval, t.created_at,
              u.first_name, u.last_name, u.msu_mail
         FROM journal_watch.t3_requests t
         JOIN journal_watch.users u ON u.user_id = t.student_id
        WHERE t.overall_status = 'Pending'
          AND (
            (t.adv_user_id = ? AND t.adv_status = 'Pending')
            OR (t.co1_user_id = ? AND t.co1_status = 'Pending')
            OR (t.co2_user_id = ? AND t.co2_status = 'Pending')
          )
        ORDER BY t.created_at ASC`,
      [advisorId, advisorId, advisorId]
    );
    return rows;
  }

  /**
   * ดึงประวัติที่ Advisor คนนี้เคยอนุมัติ/ปฏิเสธแล้ว
   * @param {number} advisorId
   * @param {object} opts - { status: 'Approved'|'Rejected'|null, page, limit }
   */
  static async findReviewedByAdvisor(advisorId, { status = null, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const statusCondition = status
      ? `AND (
          (t.adv_user_id = ? AND t.adv_status = ?)
          OR (t.co1_user_id = ? AND t.co1_status = ?)
          OR (t.co2_user_id = ? AND t.co2_status = ?)
        )`
      : `AND (
          (t.adv_user_id = ? AND t.adv_status IN ('Approved','Rejected'))
          OR (t.co1_user_id = ? AND t.co1_status IN ('Approved','Rejected'))
          OR (t.co2_user_id = ? AND t.co2_status IN ('Approved','Rejected'))
        )`;

    const params = status
      ? [advisorId, status, advisorId, status, advisorId, status]
      : [advisorId, advisorId, advisorId];

    const [rows] = await db.query(
      `SELECT t.t3_id, t.pre_t3_id, t.issn, t.overall_status,
              t.journal_snapshot, t.paper_and_research_details, t.publication_details,
              t.advisor_approval, t.co_advisor_1_approval, t.co_advisor_2_approval,
              t.faculty_com_approval, t.grad_school_approval,
              t.created_at, t.updated_at,
              u.first_name, u.last_name, u.msu_mail
         FROM journal_watch.t3_requests t
         JOIN journal_watch.users u ON u.user_id = t.student_id
        WHERE 1=1
          ${statusCondition}
        ORDER BY t.updated_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM journal_watch.t3_requests t
        WHERE 1=1
          ${statusCondition}`,
      params
    );

    return { rows, total: countRows[0].total };
  }

  /**
   * ดึงประวัติที่ Staff (Faculty Com) เคยอนุมัติ/ปฏิเสธแล้ว
   * @param {object} opts - { status: 'Approved'|'Rejected'|null, page, limit }
   */
  static async findReviewedByFaculty({ status = null, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const statusCondition = status
      ? `AND t.faculty_status = ?`
      : `AND t.faculty_status IN ('Approved', 'Rejected')`;

    const params = status ? [status] : [];

    const [rows] = await db.query(
      `SELECT t.t3_id, t.pre_t3_id, t.issn, t.overall_status,
              t.journal_snapshot, t.paper_and_research_details, t.publication_details,
              t.advisor_approval, t.faculty_com_approval, t.grad_school_approval,
              t.created_at, t.updated_at,
              u.first_name, u.last_name, u.msu_mail
         FROM journal_watch.t3_requests t
         JOIN journal_watch.users u ON u.user_id = t.student_id
        WHERE 1=1
          ${statusCondition}
        ORDER BY t.updated_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM journal_watch.t3_requests t
        WHERE 1=1
          ${statusCondition}`,
      params
    );

    return { rows, total: countRows[0].total };
  }

  /**
   * ดึงรายการที่ advisor approve ครบแล้ว รอ Faculty Com
   */
  static async findPendingForFaculty() {
    const [rows] = await db.query(
      `SELECT t.t3_id, t.pre_t3_id, t.overall_status,
              t.journal_snapshot, t.paper_and_research_details, t.publication_details,
              t.journal_metrics,
              t.advisor_approval, t.faculty_com_approval, t.grad_school_approval,
              t.created_at,
              u.first_name, u.last_name, u.msu_mail
         FROM journal_watch.t3_requests t
         JOIN journal_watch.users u ON u.user_id = t.student_id
        WHERE t.overall_status = 'Pending'
          AND t.adv_status     = 'Approved'
          AND t.faculty_status = 'Pending'
        ORDER BY t.created_at ASC`
    );
    return rows;
  }

  // ============================================================
  // UPDATE — Advisor Review
  // ============================================================

  static async advisorReview(t3Id, advisorId, action, remark) {
    const row = await T3Model.findById(t3Id);
    if (!row) return null;

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const applyReview = (slot) => {
      if (String(slot.user_id) === String(advisorId) && slot.status === 'Pending') {
        return { ...slot, status: action === 'approve' ? 'Approved' : 'Rejected', remark, approved_at: now };
      }
      return slot;
    };

    let advisorApproval = applyReview(row.advisor_approval);
    let co1Approval     = applyReview(row.co_advisor_1_approval);
    let co2Approval     = applyReview(row.co_advisor_2_approval);

    const anyRejected = [advisorApproval, co1Approval, co2Approval]
      .some(s => s.status === 'Rejected');

    const allApproved = [advisorApproval, co1Approval, co2Approval]
      .filter(s => s.status !== 'N/A')
      .every(s => s.status === 'Approved');

    const newOverallStatus = anyRejected ? 'Rejected' : row.overall_status;

    await db.query(
      `UPDATE journal_watch.t3_requests
          SET advisor_approval      = ?,
              co_advisor_1_approval = ?,
              co_advisor_2_approval = ?,
              overall_status        = ?
        WHERE t3_id = ?`,
      [
        JSON.stringify(advisorApproval),
        JSON.stringify(co1Approval),
        JSON.stringify(co2Approval),
        newOverallStatus,
        t3Id,
      ]
    );

    return { anyRejected, allApproved, newOverallStatus };
  }

  // ============================================================
  // UPDATE — Faculty Com Review
  // ============================================================

  /**
   * Faculty Com อนุมัติ/ปฏิเสธ พร้อม meeting_no, meeting_date
   * ถ้า approve → overall ยังเป็น Pending รอ Grad School (ภายนอก)
   * ถ้า reject  → overall = Rejected แจ้งกลับนิสิต
   */
  static async facultyReview(t3Id, action, meetingNo, meetingDate, remark) {
    const now    = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const status = action === 'approve' ? 'Approved' : 'Rejected';

    const facultyComApproval = {
      status,
      meeting_no:   meetingNo   || null,
      meeting_date: meetingDate || null,
      remark:       remark      || null,
      approved_at:  now,
    };

    // faculty approve/reject = ผลสุดท้าย (เจ้าหน้าที่รวมผล Grad School มาแล้ว)
    const newOverallStatus = status; // 'Approved' หรือ 'Rejected'

    // auto-fill grad_school_approval ให้ตรงกับผล faculty เพื่อ consistency ของ DB
    const gradSchoolApproval = {
      status,
      remark:            remark || null,
      approved_by_email: null,
      approved_at:       now,
    };

    await db.query(
      `UPDATE journal_watch.t3_requests
          SET faculty_com_approval  = ?,
              grad_school_approval  = ?,
              overall_status        = ?
        WHERE t3_id = ?`,
      [JSON.stringify(facultyComApproval), JSON.stringify(gradSchoolApproval), newOverallStatus, t3Id]
    );

    return { newOverallStatus, facultyApproved: action === 'approve' };
  }

  // ============================================================
  // UPDATE — Grad School Final Approval
  // ============================================================

  /**
   * Staff บันทึกผลจาก Grad School (หลังได้รับอีเมลตอบกลับจาก researchpublication@msu.ac.th)
   * @param {string} action           - 'approve' | 'reject'
   * @param {string} approvedByEmail  - อีเมลที่ตอบกลับมา
   * @param {string|null} remark
   */
  static async gradSchoolReview(t3Id, action, approvedByEmail, remark) {
    const now    = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const status = action === 'approve' ? 'Approved' : 'Rejected';

    const gradSchoolApproval = {
      status,
      remark:            remark           || null,
      approved_by_email: approvedByEmail  || null,
      approved_at:       now,
    };

    const newOverallStatus = status; // Approved หรือ Rejected

    await db.query(
      `UPDATE journal_watch.t3_requests
          SET grad_school_approval = ?,
              overall_status       = ?
        WHERE t3_id = ?`,
      [JSON.stringify(gradSchoolApproval), newOverallStatus, t3Id]
    );

    return { newOverallStatus };
  }

  // ============================================================
  // UPDATE — Submission Details (วันที่ยื่น + รอบตัด)
  // ============================================================

  static async updateSubmissionDetails(t3Id, submissionDate, submissionRoundCutoff) {
    await db.query(
      `UPDATE journal_watch.t3_requests
          SET submission_date          = ?,
              submission_round_cutoff  = ?
        WHERE t3_id = ?`,
      [submissionDate, submissionRoundCutoff, t3Id]
    );
  }

  // ============================================================
  // CANCEL (นิสิตยกเลิกคำขอของตัวเอง)
  // ============================================================

  /**
   * เปลี่ยน overall_status เป็น 'Cancelled'
   * ทำได้เฉพาะตอนสถานะ Pending หรือ Rejected เท่านั้น
   */
  static async cancel(t3Id) {
    const [result] = await db.query(
      `UPDATE journal_watch.t3_requests
          SET overall_status = 'Cancelled'
        WHERE t3_id = ?
          AND overall_status IN ('Pending', 'Rejected')`,
      [t3Id]
    );
    return result.affectedRows > 0;
  }
}

module.exports = T3Model;