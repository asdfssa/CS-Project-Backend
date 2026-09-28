/**
 * T3Model
 * Data access layer สำหรับ table `t3_requests` (schema: db/init/001_schema.sql)
 *
 * เช่นเดียวกับ PreT3Model — schema v2 แปลง JSON blob columns เป็น plain typed
 * columns + `request_approvals` (หนึ่งแถวต่อหนึ่ง approval step) +
 * `t3_evidence_files` (หนึ่งแถวต่อหนึ่งไฟล์แนบ แทน journal_evidence_files JSON)
 *
 * Model นี้ประกอบ object รูปแบบเดิม (journal_snapshot, paper_and_research_details,
 * publication_details, journal_metrics, journal_evidence_files, advisor_approval, ...)
 * กลับมาให้ตอน read เพื่อให้ Controller เดิมใช้งานต่อได้โดยไม่ต้องแก้ response shape
 *
 * หมายเหตุ: t3_requests (ต่างจาก pre_t3_requests) เก็บ journal snapshot แค่
 * issn + journal_name เท่านั้น (ไม่มี journal_url/indexed_database/quartile/
 * is_discontinued/is_hijacked) ตาม schema v2
 *
 * grad_school: schema v2 เก็บเป็นคอลัมน์ตรงบน t3_requests (grad_school_status,
 * grad_school_remark, grad_school_decided_at, grad_school_relayed_by = Staff
 * user_id ที่กรอกผลจากอีเมล) แทน JSON blob เดิมที่เก็บ approved_by_email
 */
const db = require('../config/database');

const FILE_TYPE_TO_KEY = {
  Acceptance_Letter:   'acceptance_letter_path',
  Full_Paper:          'full_paper_path',
  Journal_Cover:       'journal_cover_path',
  Table_Of_Contents:   'table_of_contents_path',
  Database_Evidence:   'database_evidence_path',
  Peer_Review_Result:  'peer_review_result_path',
};

const KEY_TO_FILE_TYPE = Object.fromEntries(
  Object.entries(FILE_TYPE_TO_KEY).map(([fileType, key]) => [key, fileType])
);

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

    const [result] = await db.query(
      `INSERT INTO t3_requests
         (pre_t3_id, student_id, issn, journal_name,
          degree_level, curriculum_year, study_plan_code,
          title_thai, title_english, first_author, corresponding_author,
          innovation_type, innovation_detail,
          publication_type, weight_score, specified_database, publication_status,
          volume, issue, publish_year,
          has_impact_score, impact_factor, citescore, score_year,
          overall_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
      [
        preT3Id,
        studentId,
        issn,
        journalSnapshot.journal_name,
        studentSnapshot.degree_level,
        studentSnapshot.curriculum_year,
        studentSnapshot.study_plan_code,
        paperAndResearchDetails.title_thai,
        paperAndResearchDetails.title_english,
        paperAndResearchDetails.first_author,
        paperAndResearchDetails.corresponding_author,
        paperAndResearchDetails.innovation_type || 'None',
        paperAndResearchDetails.innovation_detail || null,
        publicationDetails.type,
        publicationDetails.weight_score,
        publicationDetails.specified_database || null,
        publicationDetails.status,
        publicationDetails.volume || null,
        publicationDetails.issue || null,
        publicationDetails.publish_year || null,
        journalMetrics.has_impact_score ? 1 : 0,
        journalMetrics.impact_factor ?? null,
        journalMetrics.citescore ?? null,
        journalMetrics.score_year || null,
      ]
    );

    const t3Id = result.insertId;

    const approvalRows = [['Advisor', majorAdvisorId]];
    if (coAdvisor1Id) approvalRows.push(['Co_Advisor_1', coAdvisor1Id]);
    if (coAdvisor2Id) approvalRows.push(['Co_Advisor_2', coAdvisor2Id]);
    approvalRows.push(['Faculty_Committee', null]);

    for (const [step, approverId] of approvalRows) {
      await db.query(
        `INSERT INTO request_approvals (request_type, request_id, step, approver_id, status)
         VALUES ('T3', ?, ?, ?, 'Pending')`,
        [t3Id, step, approverId]
      );
    }

    return t3Id;
  }

  // ============================================================
  // Internal helpers — ประกอบ row จาก DB columns กลับเป็น shape เดิม
  // ============================================================

  static _buildJournalSnapshot(row) {
    return { issn: row.issn, journal_name: row.journal_name };
  }

  static _buildStudentSnapshot(row) {
    return {
      degree_level:    row.degree_level,
      study_plan_code: row.study_plan_code,
      curriculum_year: row.curriculum_year,
    };
  }

  static _buildPaperAndResearchDetails(row) {
    return {
      title_thai:            row.title_thai,
      title_english:         row.title_english,
      first_author:          row.first_author,
      corresponding_author:  row.corresponding_author,
      innovation_type:       row.innovation_type,
      innovation_detail:     row.innovation_detail,
    };
  }

  static _buildPublicationDetails(row) {
    return {
      type:               row.publication_type,
      weight_score:       row.weight_score,
      specified_database: row.specified_database,
      status:             row.publication_status,
      volume:             row.volume,
      issue:              row.issue,
      publish_year:       row.publish_year,
    };
  }

  static _buildJournalMetrics(row) {
    return {
      has_impact_score: !!row.has_impact_score,
      impact_factor:    row.impact_factor,
      citescore:        row.citescore,
      score_year:       row.score_year,
    };
  }

  static _buildGradSchoolApproval(row) {
    return {
      status:             row.grad_school_status,
      remark:             row.grad_school_remark,
      approved_by_email:  null,
      relayed_by:         row.grad_school_relayed_by,
      approved_at:        row.grad_school_decided_at,
    };
  }

  static async _fetchApprovalsMap(t3Ids) {
    if (!t3Ids.length) return {};
    const [rows] = await db.query(
      `SELECT request_id, step, approver_id, status, remark, meeting_no, meeting_date, decided_at
         FROM request_approvals
        WHERE request_type = 'T3' AND request_id IN (?)`,
      [t3Ids]
    );
    const map = {};
    for (const r of rows) {
      if (!map[r.request_id]) map[r.request_id] = {};
      map[r.request_id][r.step] = r;
    }
    return map;
  }

  static async _fetchEvidenceFilesMap(t3Ids) {
    if (!t3Ids.length) return {};
    const [rows] = await db.query(
      `SELECT t3_id, file_type, file_path FROM t3_evidence_files WHERE t3_id IN (?)`,
      [t3Ids]
    );
    const map = {};
    for (const id of t3Ids) {
      map[id] = {
        acceptance_letter_path:  null,
        full_paper_path:         null,
        journal_cover_path:      null,
        table_of_contents_path:  null,
        database_evidence_path:  null,
        peer_review_result_path: null,
      };
    }
    for (const r of rows) {
      const key = FILE_TYPE_TO_KEY[r.file_type];
      if (key) map[r.t3_id][key] = r.file_path;
    }
    return map;
  }

  static _slotFromApproval(approvalRow, { withMeeting = false } = {}) {
    if (!approvalRow) {
      return withMeeting
        ? { status: 'Pending', meeting_no: null, meeting_date: null, remark: null, approved_at: null }
        : { status: 'N/A', user_id: null, remark: null, approved_at: null };
    }
    if (withMeeting) {
      return {
        status:       approvalRow.status,
        meeting_no:   approvalRow.meeting_no,
        meeting_date: approvalRow.meeting_date,
        remark:       approvalRow.remark,
        approved_at:  approvalRow.decided_at,
      };
    }
    return {
      status:      approvalRow.status,
      user_id:     approvalRow.approver_id,
      remark:      approvalRow.remark,
      approved_at: approvalRow.decided_at,
    };
  }

  static async _attachDerived(rows) {
    if (!rows.length) return rows;
    const ids = rows.map(r => r.t3_id);
    const [approvalsMap, evidenceMap] = await Promise.all([
      T3Model._fetchApprovalsMap(ids),
      T3Model._fetchEvidenceFilesMap(ids),
    ]);

    return rows.map(row => {
      const steps = approvalsMap[row.t3_id] || {};
      return {
        ...row,
        journal_snapshot:           T3Model._buildJournalSnapshot(row),
        student_snapshot:           T3Model._buildStudentSnapshot(row),
        paper_and_research_details: T3Model._buildPaperAndResearchDetails(row),
        publication_details:        T3Model._buildPublicationDetails(row),
        journal_metrics:            T3Model._buildJournalMetrics(row),
        journal_evidence_files:     evidenceMap[row.t3_id],
        advisor_approval:           T3Model._slotFromApproval(steps.Advisor),
        co_advisor_1_approval:      T3Model._slotFromApproval(steps.Co_Advisor_1),
        co_advisor_2_approval:      T3Model._slotFromApproval(steps.Co_Advisor_2),
        faculty_com_approval:       T3Model._slotFromApproval(steps.Faculty_Committee, { withMeeting: true }),
        grad_school_approval:       T3Model._buildGradSchoolApproval(row),
      };
    });
  }

  // ============================================================
  // Evidence files (t3_evidence_files)
  // ============================================================

  static async upsertEvidenceFile(t3Id, fieldName, filePath) {
    const fileType = KEY_TO_FILE_TYPE[fieldName] || KEY_TO_FILE_TYPE[`${fieldName}_path`];
    if (!fileType) return false;
    await db.query(
      `INSERT INTO t3_evidence_files (t3_id, file_type, file_path)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE file_path = VALUES(file_path), uploaded_at = NOW()`,
      [t3Id, fileType, filePath]
    );
    return true;
  }

  static async removeEvidenceFile(t3Id, fieldName) {
    const fileType = KEY_TO_FILE_TYPE[fieldName] || KEY_TO_FILE_TYPE[`${fieldName}_path`];
    if (!fileType) return false;
    await db.query(
      `DELETE FROM t3_evidence_files WHERE t3_id = ? AND file_type = ?`,
      [t3Id, fileType]
    );
    return true;
  }

  static async getEvidenceFiles(t3Id) {
    const map = await T3Model._fetchEvidenceFilesMap([t3Id]);
    return map[t3Id];
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
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
        WHERE t.t3_id = ?
        LIMIT 1`,
      [t3Id]
    );
    if (!rows[0]) return null;
    const [attached] = await T3Model._attachDerived(rows);
    return attached;
  }

  /**
   * ดึง T3 ทั้งหมดของนิสิตคนนึง (เรียงใหม่สุดก่อน)
   */
  static async findByStudentId(studentId) {
    const [rows] = await db.query(
      `SELECT *
         FROM t3_requests
        WHERE student_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [studentId]
    );
    return T3Model._attachDerived(rows);
  }

  /**
   * ดึงรายการที่รอ Advisor คนนี้อนุมัติ
   */
  static async findPendingForAdvisor(advisorId) {
    const [rows] = await db.query(
      `SELECT t.*, u.first_name, u.last_name, u.msu_mail
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
        WHERE t.overall_status = 'Pending'
          AND EXISTS (
            SELECT 1 FROM request_approvals ra
             WHERE ra.request_type = 'T3' AND ra.request_id = t.t3_id
               AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
               AND ra.approver_id = ? AND ra.status = 'Pending'
          )
        ORDER BY t.created_at ASC`,
      [advisorId]
    );
    return T3Model._attachDerived(rows);
  }

  /**
   * ดึงประวัติที่ Advisor คนนี้เคยอนุมัติ/ปฏิเสธแล้ว
   * @param {number} advisorId
   * @param {object} opts - { status: 'Approved'|'Rejected'|null, page, limit }
   */
  static async findReviewedByAdvisor(advisorId, { status = null, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const statusCondition = status ? `AND ra.status = ?` : `AND ra.status IN ('Approved','Rejected')`;
    const statusParams = status ? [status] : [];

    const [rows] = await db.query(
      `SELECT t.*, u.first_name, u.last_name, u.msu_mail
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
         JOIN request_approvals ra
           ON ra.request_type = 'T3' AND ra.request_id = t.t3_id
          AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
          AND ra.approver_id = ?
        WHERE 1=1
          ${statusCondition}
        ORDER BY t.updated_at DESC
        LIMIT ? OFFSET ?`,
      [advisorId, ...statusParams, limit, offset]
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM t3_requests t
         JOIN request_approvals ra
           ON ra.request_type = 'T3' AND ra.request_id = t.t3_id
          AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
          AND ra.approver_id = ?
        WHERE 1=1
          ${statusCondition}`,
      [advisorId, ...statusParams]
    );

    return { rows: await T3Model._attachDerived(rows), total: countRows[0].total };
  }

  /**
   * ดึงประวัติที่ Staff (Faculty Com) เคยอนุมัติ/ปฏิเสธแล้ว
   * @param {object} opts - { status: 'Approved'|'Rejected'|null, page, limit }
   */
  static async findReviewedByFaculty({ status = null, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const statusCondition = status ? `AND ra.status = ?` : `AND ra.status IN ('Approved','Rejected')`;
    const statusParams = status ? [status] : [];

    const [rows] = await db.query(
      `SELECT t.*, u.first_name, u.last_name, u.msu_mail
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
         JOIN request_approvals ra
           ON ra.request_type = 'T3' AND ra.request_id = t.t3_id
          AND ra.step = 'Faculty_Committee'
        WHERE 1=1
          ${statusCondition}
        ORDER BY t.updated_at DESC
        LIMIT ? OFFSET ?`,
      [...statusParams, limit, offset]
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM t3_requests t
         JOIN request_approvals ra
           ON ra.request_type = 'T3' AND ra.request_id = t.t3_id
          AND ra.step = 'Faculty_Committee'
        WHERE 1=1
          ${statusCondition}`,
      statusParams
    );

    return { rows: await T3Model._attachDerived(rows), total: countRows[0].total };
  }

  /**
   * ดึงรายการที่ advisor approve ครบแล้ว รอ Faculty Com
   */
  static async findPendingForFaculty() {
    const [rows] = await db.query(
      `SELECT t.*, u.first_name, u.last_name, u.msu_mail
         FROM t3_requests t
         JOIN users u ON u.user_id = t.student_id
         JOIN request_approvals fac
           ON fac.request_type = 'T3' AND fac.request_id = t.t3_id
          AND fac.step = 'Faculty_Committee' AND fac.status = 'Pending'
        WHERE t.overall_status = 'Pending'
          AND NOT EXISTS (
            SELECT 1 FROM request_approvals ra
             WHERE ra.request_type = 'T3' AND ra.request_id = t.t3_id
               AND ra.step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
               AND ra.status <> 'Approved'
          )
        ORDER BY t.created_at ASC`
    );
    return T3Model._attachDerived(rows);
  }

  // ============================================================
  // UPDATE — Advisor Review
  // ============================================================

  static async advisorReview(t3Id, advisorId, action, remark) {
    const [pendingSlot] = await db.query(
      `SELECT approval_id, step FROM request_approvals
        WHERE request_type = 'T3' AND request_id = ?
          AND step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')
          AND approver_id = ? AND status = 'Pending'
        LIMIT 1`,
      [t3Id, advisorId]
    );
    if (!pendingSlot.length) return null;

    const newStatus = action === 'approve' ? 'Approved' : 'Rejected';
    await db.query(
      `UPDATE request_approvals SET status = ?, remark = ?, decided_at = NOW() WHERE approval_id = ?`,
      [newStatus, remark, pendingSlot[0].approval_id]
    );

    if (action === 'approve' && pendingSlot[0].step === 'Advisor') {
      await db.query(
        `UPDATE request_approvals SET status = 'Approved', decided_at = NOW()
          WHERE request_type = 'T3' AND request_id = ?
            AND step IN ('Co_Advisor_1','Co_Advisor_2') AND status = 'Pending'`,
        [t3Id]
      );
    }

    const [advisorSteps] = await db.query(
      `SELECT status FROM request_approvals
        WHERE request_type = 'T3' AND request_id = ?
          AND step IN ('Advisor','Co_Advisor_1','Co_Advisor_2')`,
      [t3Id]
    );

    const anyRejected = advisorSteps.some(s => s.status === 'Rejected');
    const allApproved = advisorSteps.every(s => s.status === 'Approved');

    const newOverallStatus = anyRejected ? 'Rejected' : 'Pending';
    if (anyRejected) {
      await db.query(`UPDATE t3_requests SET overall_status = 'Rejected' WHERE t3_id = ?`, [t3Id]);
    }

    return { anyRejected, allApproved, newOverallStatus };
  }

  // ============================================================
  // UPDATE — Faculty Com Review
  // ============================================================

  /**
   * Faculty Com อนุมัติ/ปฏิเสธ พร้อม meeting_no, meeting_date
   * ในระบบเดิม faculty approve/reject = ผลสุดท้าย (เจ้าหน้าที่รวมผล Grad School
   * มาแล้ว) จึง auto-fill grad_school_* ให้ตรงกับผล faculty เพื่อ consistency
   * ของ DB เช่นเดิม
   */
  static async facultyReview(t3Id, action, meetingNo, meetingDate, remark) {
    const status = action === 'approve' ? 'Approved' : 'Rejected';

    await db.query(
      `UPDATE request_approvals
          SET status = ?, meeting_no = ?, meeting_date = ?, remark = ?, decided_at = NOW()
        WHERE request_type = 'T3' AND request_id = ? AND step = 'Faculty_Committee'`,
      [status, meetingNo || null, meetingDate || null, remark || null, t3Id]
    );

    await db.query(
      `UPDATE t3_requests
          SET overall_status         = ?,
              grad_school_status     = ?,
              grad_school_remark     = ?,
              grad_school_decided_at = NOW()
        WHERE t3_id = ?`,
      [status, status, remark || null, t3Id]
    );

    return { newOverallStatus: status, facultyApproved: action === 'approve' };
  }

  // ============================================================
  // UPDATE — Grad School Final Approval
  // ============================================================

  /**
   * Staff บันทึกผลจาก Grad School (หลังได้รับอีเมลตอบกลับจาก researchpublication@msu.ac.th)
   * @param {number} t3Id
   * @param {string} action           - 'approve' | 'reject'
   * @param {string|null} remark
   * @param {number|null} relayedByUserId  - Staff user_id ที่กรอกผล (schema v2 เก็บ user_id แทนอีเมลที่ตอบกลับ)
   */
  static async gradSchoolReview(t3Id, action, remark, relayedByUserId = null) {
    const status = action === 'approve' ? 'Approved' : 'Rejected';

    await db.query(
      `UPDATE t3_requests
          SET grad_school_status     = ?,
              grad_school_remark     = ?,
              grad_school_decided_at = NOW(),
              grad_school_relayed_by = ?,
              overall_status         = ?
        WHERE t3_id = ?`,
      [status, remark || null, relayedByUserId, status, t3Id]
    );

    return { newOverallStatus: status };
  }

  // ============================================================
  // UPDATE — Submission Details (วันที่ยื่น + รอบตัด)
  // ============================================================

  static async updateSubmissionDetails(t3Id, submissionDate, submissionRoundCutoff) {
    await db.query(
      `UPDATE t3_requests
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
      `UPDATE t3_requests
          SET overall_status = 'Cancelled'
        WHERE t3_id = ?
          AND overall_status IN ('Pending', 'Rejected')`,
      [t3Id]
    );
    return result.affectedRows > 0;
  }
}

module.exports = T3Model;
