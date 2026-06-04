/**
 * T3Controller
 * จัดการ request/response สำหรับ T3 workflow
 *
 * Endpoints:
 *   POST   /api/t3                          → นิสิตยื่น T3 ใหม่
 *   GET    /api/t3/my                       → นิสิตดูประวัติของตัวเอง
 *   GET    /api/t3/pending                  → Advisor/Staff ดูรายการรออนุมัติ
 *   GET    /api/t3/:id                      → ดูรายละเอียด
 *   PATCH  /api/t3/:id/advisor-review       → Advisor อนุมัติ/ปฏิเสธ
 *   PATCH  /api/t3/:id/faculty-review       → Staff บันทึกมติ Faculty Com
 *   PATCH  /api/t3/:id/grad-school-review   → Staff บันทึกผล Grad School (จากอีเมล)
 */
const path = require('path');
const fs   = require('fs');
const T3Model     = require('../models/T3Model');
const PreT3Model  = require('../models/PreT3Model');
const UserModel   = require('../models/UserModel');
const MailService = require('../services/MailService');
const db          = require('../config/database');
const { serverError } = require('../utils/errorResponse');

const FIELD_TO_KEY = {
  acceptance_letter:  'acceptance_letter_path',
  full_paper:         'full_paper_path',
  journal_cover:      'journal_cover_path',
  table_of_contents:  'table_of_contents_path',
  database_evidence:  'database_evidence_path',
  peer_review_result: 'peer_review_result_path',
};

class T3Controller {
  // ============================================================
  // POST /api/t3
  // Role: Student
  // ============================================================
  static async submit(req, res) {
    try {
      const studentId = req.user.sub;
      const {
        pre_t3_id,
        journal_snapshot,
        paper_and_research_details,
        publication_details,
        journal_metrics,
      } = req.body;

      // --- Validate required fields ---
      if (!pre_t3_id || !journal_snapshot || !paper_and_research_details || !publication_details || !journal_metrics) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_FIELDS',
          message: 'กรุณาระบุ pre_t3_id, journal_snapshot, paper_and_research_details, publication_details, journal_metrics',
        });
      }

      // ตรวจ paper_and_research_details fields
      const paperRequired = ['title_thai', 'title_english', 'first_author', 'corresponding_author'];
      for (const field of paperRequired) {
        if (!paper_and_research_details[field]) {
          return res.status(400).json({
            success: false,
            code: 'MISSING_PAPER_FIELD',
            message: `paper_and_research_details.${field} จำเป็นต้องระบุ`,
          });
        }
      }

      // ตรวจ publication_details
      const pubRequired = ['type', 'weight_score'];
      for (const field of pubRequired) {
        if (publication_details[field] === undefined) {
          return res.status(400).json({
            success: false,
            code: 'MISSING_PUB_FIELD',
            message: `publication_details.${field} จำเป็นต้องระบุ`,
          });
        }
      }

      // ตรวจ has_impact_score + impact_factor
      if (journal_metrics.has_impact_score === undefined) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_METRICS',
          message: 'journal_metrics.has_impact_score จำเป็นต้องระบุ',
        });
      }

      // ตรวจ Pre-T3 ต้อง Approved และเป็นของนิสิตคนนี้
      const preT3 = await PreT3Model.findById(pre_t3_id);
      if (!preT3) {
        return res.status(404).json({ success: false, code: 'PRE_T3_NOT_FOUND', message: 'ไม่พบ Pre-T3 นี้' });
      }
      if (preT3.student_id !== studentId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Pre-T3 นี้ไม่ใช่ของคุณ' });
      }
      if (preT3.overall_status !== 'Approved') {
        return res.status(400).json({
          success: false,
          code: 'PRE_T3_NOT_APPROVED',
          message: `Pre-T3 ต้องได้รับการอนุมัติก่อน (สถานะปัจจุบัน: ${preT3.overall_status})`,
        });
      }

      // ดึงข้อมูลนิสิต
      const student = await UserModel.findById(studentId);
      if (!student) {
        return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบข้อมูลผู้ใช้' });
      }

      const studentSnapshot = {
        degree_level:    student.degree_level,
        study_plan_code: student.study_plan_code,
        curriculum_year: student.curriculum_year,
      };

      // ดึง Advisor ของนิสิต
      const [advisorRows] = await db.query(
        `SELECT advisor_id, advisor_type
           FROM journal_watch.advisor_assignments
          WHERE student_id = ? AND is_active = TRUE`,
        [studentId]
      );

      const majorAdvisor = advisorRows.find(a => a.advisor_type === 'Major');
      const co1Advisor   = advisorRows.find(a => a.advisor_type === 'Co_1');
      const co2Advisor   = advisorRows.find(a => a.advisor_type === 'Co_2');

      if (!majorAdvisor) {
        return res.status(400).json({ success: false, code: 'NO_MAJOR_ADVISOR', message: 'ยังไม่มีอาจารย์ที่ปรึกษาหลัก' });
      }

      const issn = journal_snapshot.issn;

      const t3Id = await T3Model.create(
        studentId,
        pre_t3_id,
        issn,
        journal_snapshot,
        studentSnapshot,
        paper_and_research_details,
        publication_details,
        journal_metrics,
        {
          majorAdvisorId: majorAdvisor.advisor_id,
          coAdvisor1Id:   co1Advisor?.advisor_id || null,
          coAdvisor2Id:   co2Advisor?.advisor_id || null,
        }
      );

      // แจ้ง Advisor ทางอีเมล
      const advisorUser = await UserModel.findById(majorAdvisor.advisor_id);
      if (advisorUser) {
        await MailService.sendT3Notification(advisorUser.msu_mail, 'advisor_pending', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName: journal_snapshot.journal_name,
          articleTitle: paper_and_research_details.title_english || paper_and_research_details.title_thai,
          t3Id,
        });
      }

      return res.status(201).json({
        success: true,
        message: 'ยื่น T3 สำเร็จ กรุณารอการอนุมัติจากอาจารย์ที่ปรึกษา',
        data: { t3_id: t3Id },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.submit');
    }
  }

  // ============================================================
  // GET /api/t3/my
  // Role: Student
  // ============================================================
  static async getMyRequests(req, res) {
    try {
      const studentId = req.user.sub;
      const rows = await T3Model.findByStudentId(studentId);

      return res.json({
        success: true,
        data: rows.map(r => T3Controller._formatRow(r)),
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getMyRequests');
    }
  }

  // ============================================================
  // GET /api/t3/pending
  // Role: Supervisor → ของนิสิตตัวเอง
  //       Staff      → ทั้งหมดที่ advisor approve แล้ว
  // ============================================================
  static async getPending(req, res) {
    try {
      const { role, sub: userId } = req.user;

      let rows;
      if (role === 'Supervisor') {
        rows = await T3Model.findPendingForAdvisor(userId);
      } else {
        rows = await T3Model.findPendingForFaculty();
      }

      return res.json({
        success: true,
        data: rows.map(r => T3Controller._formatRow(r)),
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getPending');
    }
  }

  // ============================================================
  // GET /api/t3/:id
  // Role: Student (ของตัวเอง), Supervisor (ของนิสิตตัวเอง), Staff/Admin (ทุกคน)
  // ============================================================
  static async getById(req, res) {
    try {
      const t3Id = parseInt(req.params.id);
      const { role, sub: userId } = req.user;

      const row = await T3Model.findById(t3Id);
      if (!row) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });
      }

      if (role === 'Student' && row.student_id !== userId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ดูรายการนี้' });
      }

      if (role === 'Supervisor') {
        const isMyStudent =
          String(row.advisor_approval?.user_id)    === String(userId) ||
          String(row.co_advisor_1_approval?.user_id) === String(userId) ||
          String(row.co_advisor_2_approval?.user_id) === String(userId);

        if (!isMyStudent) {
          return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ดูรายการนี้' });
        }
      }

      return res.json({ success: true, data: T3Controller._formatRow(row) });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getById');
    }
  }

  // ============================================================
  // PATCH /api/t3/:id/advisor-review
  // Role: Supervisor
  // ============================================================
  static async advisorReview(req, res) {
    try {
      const t3Id     = parseInt(req.params.id);
      const advisorId = req.user.sub;
      const { action, remark } = req.body;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, code: 'INVALID_ACTION', message: 'action ต้องเป็น approve หรือ reject' });
      }
      if (action === 'reject' && !remark) {
        return res.status(400).json({ success: false, code: 'REMARK_REQUIRED', message: 'กรุณาระบุเหตุผลการปฏิเสธ' });
      }

      const row = await T3Model.findById(t3Id);
      if (!row) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });

      if (row.overall_status !== 'Pending') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `T3 นี้อยู่ในสถานะ ${row.overall_status} แล้ว` });
      }

      const slots = [row.advisor_approval, row.co_advisor_1_approval, row.co_advisor_2_approval];
      const mySlot = slots.find(s => String(s?.user_id) === String(advisorId) && s.status === 'Pending');
      if (!mySlot) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'คุณไม่ใช่อาจารย์ที่ปรึกษาของ T3 นี้ หรืออนุมัติแล้ว' });
      }

      const result = await T3Model.advisorReview(t3Id, advisorId, action, remark || null);

      const student    = await UserModel.findById(row.student_id);
      const journalName = row.journal_snapshot?.journal_name || '-';
      const articleTitle = row.paper_and_research_details?.title_english || row.paper_and_research_details?.title_thai || '-';

      if (result.anyRejected) {
        await MailService.sendT3Notification(student.msu_mail, 'advisor_rejected', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          articleTitle,
          t3Id,
          remark,
        });
      } else if (result.allApproved) {
        // แจ้ง Staff ทุกคน
        const [staffRows] = await db.query(
          `SELECT msu_mail FROM journal_watch.users WHERE role = 'Staff' AND account_status = 'Active' AND deleted_at IS NULL`
        );
        for (const staff of staffRows) {
          await MailService.sendT3Notification(staff.msu_mail, 'faculty_pending', {
            studentName: `${student.first_name} ${student.last_name}`,
            journalName,
            articleTitle,
            t3Id,
          });
        }
      }

      return res.json({
        success: true,
        message: action === 'approve' ? 'อนุมัติเรียบร้อย' : 'ปฏิเสธเรียบร้อย',
        data: { overall_status: result.newOverallStatus, all_advisor_approved: result.allApproved },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.advisorReview');
    }
  }

  // ============================================================
  // PATCH /api/t3/:id/faculty-review
  // Role: Staff
  // Body: { action, meeting_no, meeting_date, remark? }
  // ============================================================
  static async facultyReview(req, res) {
    try {
      const t3Id = parseInt(req.params.id);
      const { action, meeting_no, meeting_date, remark } = req.body;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, code: 'INVALID_ACTION', message: 'action ต้องเป็น approve หรือ reject' });
      }
      if (action === 'approve' && (!meeting_no || !meeting_date)) {
        return res.status(400).json({ success: false, code: 'MEETING_REQUIRED', message: 'กรุณาระบุ meeting_no และ meeting_date' });
      }
      if (action === 'reject' && !remark) {
        return res.status(400).json({ success: false, code: 'REMARK_REQUIRED', message: 'กรุณาระบุเหตุผลการปฏิเสธ' });
      }

      const row = await T3Model.findById(t3Id);
      if (!row) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });

      if (row.advisor_approval?.status !== 'Approved') {
        return res.status(400).json({ success: false, code: 'ADVISOR_NOT_APPROVED', message: 'อาจารย์ที่ปรึกษายังไม่อนุมัติ' });
      }
      if (row.overall_status !== 'Pending') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `T3 นี้อยู่ในสถานะ ${row.overall_status} แล้ว` });
      }

      const result = await T3Model.facultyReview(t3Id, action, meeting_no, meeting_date, remark);

      const student    = await UserModel.findById(row.student_id);
      const journalName = row.journal_snapshot?.journal_name || '-';
      const articleTitle = row.paper_and_research_details?.title_english || row.paper_and_research_details?.title_thai || '-';

      if (action === 'approve') {
        // Faculty approve → แจ้งนิสิตว่าส่งเรื่องต่อ Grad School แล้ว
        await MailService.sendT3Notification(student.msu_mail, 'faculty_approved', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          articleTitle,
          t3Id,
          meetingNo: meeting_no,
          meetingDate: meeting_date,
        });
      } else {
        // Faculty reject → แจ้งนิสิตว่าถูกปฏิเสธ
        await MailService.sendT3Notification(student.msu_mail, 'faculty_rejected', {
          studentName: `${student.first_name} ${student.last_name}`,
          journalName,
          articleTitle,
          t3Id,
          remark,
        });
      }

      return res.json({
        success: true,
        message: action === 'approve'
          ? 'บันทึกมติ Faculty Com เรียบร้อย รอผลจาก Grad School'
          : 'ปฏิเสธ T3 เรียบร้อย',
        data: { overall_status: result.newOverallStatus },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.facultyReview');
    }
  }

  // ============================================================
  // PATCH /api/t3/:id/grad-school-review
  // Role: Staff
  // Body: { action, approved_by_email, remark? }
  // Staff บันทึกผลหลังได้รับอีเมลตอบกลับจาก researchpublication@msu.ac.th
  // ============================================================
  static async gradSchoolReview(req, res) {
    try {
      const t3Id = parseInt(req.params.id);
      const { action, approved_by_email, remark } = req.body;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, code: 'INVALID_ACTION', message: 'action ต้องเป็น approve หรือ reject' });
      }

      const row = await T3Model.findById(t3Id);
      if (!row) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });

      // Faculty Com ต้อง approve ก่อน
      if (row.faculty_com_approval?.status !== 'Approved') {
        return res.status(400).json({ success: false, code: 'FACULTY_NOT_APPROVED', message: 'คณะกรรมการบัณฑิตศึกษายังไม่อนุมัติ' });
      }
      if (row.overall_status !== 'Pending') {
        return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `T3 นี้อยู่ในสถานะ ${row.overall_status} แล้ว` });
      }

      const result = await T3Model.gradSchoolReview(t3Id, action, approved_by_email, remark);

      // แจ้งนิสิตผลสุดท้าย
      const student    = await UserModel.findById(row.student_id);
      const journalName = row.journal_snapshot?.journal_name || '-';
      const articleTitle = row.paper_and_research_details?.title_english || row.paper_and_research_details?.title_thai || '-';

      const event = action === 'approve' ? 'grad_school_approved' : 'grad_school_rejected';
      await MailService.sendT3Notification(student.msu_mail, event, {
        studentName: `${student.first_name} ${student.last_name}`,
        journalName,
        articleTitle,
        t3Id,
        remark,
      });

      return res.json({
        success: true,
        message: action === 'approve' ? 'T3 ได้รับการอนุมัติจาก Grad School เรียบร้อย' : 'T3 ถูกปฏิเสธโดย Grad School',
        data: { overall_status: result.newOverallStatus },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.gradSchoolReview');
    }
  }

  // ============================================================
  // PATCH /api/t3/:id/cancel
  // Role: Student (เฉพาะของตัวเอง, สถานะ Pending หรือ Rejected)
  // ============================================================
  static async cancel(req, res) {
    try {
      const t3Id      = parseInt(req.params.id);
      const studentId = req.user.sub;

      const row = await T3Model.findById(t3Id);
      if (!row) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ T3 นี้' });
      }
      if (row.student_id !== studentId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ยกเลิกรายการนี้' });
      }
      if (!['Pending', 'Rejected'].includes(row.overall_status)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_STATE',
          message: `ไม่สามารถยกเลิกได้ T3 อยู่ในสถานะ ${row.overall_status}`,
        });
      }

      await T3Model.cancel(t3Id);

      return res.json({ success: true, message: 'ยกเลิก T3 เรียบร้อยแล้ว' });
    } catch (err) {
      return serverError(res, err, 'T3Controller.cancel');
    }
  }

  // ============================================================
  // POST /api/t3/with-files
  // Role: Student
  // Content-Type: multipart/form-data
  // Text fields (JSON string): pre_t3_id, journal_snapshot,
  //   paper_and_research_details, publication_details, journal_metrics
  // File fields (optional): acceptance_letter, full_paper, journal_cover,
  //   table_of_contents, database_evidence, peer_review_result
  // ============================================================
  static async submitWithFiles(req, res) {
    try {
      const studentId = req.user.sub;

      // multipart/form-data → ค่า JSON ส่งมาเป็น string ต้อง parse
      const tryParse = (val) => {
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return val; } }
        return val;
      };

      const pre_t3_id                  = tryParse(req.body.pre_t3_id);
      const journal_snapshot           = tryParse(req.body.journal_snapshot);
      const paper_and_research_details = tryParse(req.body.paper_and_research_details);
      const publication_details        = tryParse(req.body.publication_details);
      const journal_metrics            = tryParse(req.body.journal_metrics);

      // --- Validate required fields ---
      if (!pre_t3_id || !journal_snapshot || !paper_and_research_details || !publication_details || !journal_metrics) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_FIELDS',
          message: 'กรุณาระบุ pre_t3_id, journal_snapshot, paper_and_research_details, publication_details, journal_metrics',
        });
      }

      const paperRequired = ['title_thai', 'title_english', 'first_author', 'corresponding_author'];
      for (const field of paperRequired) {
        if (!paper_and_research_details[field]) {
          return res.status(400).json({
            success: false,
            code: 'MISSING_PAPER_FIELD',
            message: `paper_and_research_details.${field} จำเป็นต้องระบุ`,
          });
        }
      }

      const pubRequired = ['type', 'weight_score'];
      for (const field of pubRequired) {
        if (publication_details[field] === undefined) {
          return res.status(400).json({
            success: false,
            code: 'MISSING_PUB_FIELD',
            message: `publication_details.${field} จำเป็นต้องระบุ`,
          });
        }
      }

      if (journal_metrics.has_impact_score === undefined) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_METRICS',
          message: 'journal_metrics.has_impact_score จำเป็นต้องระบุ',
        });
      }

      const preT3 = await PreT3Model.findById(pre_t3_id);
      if (!preT3) {
        return res.status(404).json({ success: false, code: 'PRE_T3_NOT_FOUND', message: 'ไม่พบ Pre-T3 นี้' });
      }
      if (preT3.student_id !== studentId) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Pre-T3 นี้ไม่ใช่ของคุณ' });
      }
      if (preT3.overall_status !== 'Approved') {
        return res.status(400).json({
          success: false,
          code: 'PRE_T3_NOT_APPROVED',
          message: `Pre-T3 ต้องได้รับการอนุมัติก่อน (สถานะปัจจุบัน: ${preT3.overall_status})`,
        });
      }

      const student = await UserModel.findById(studentId);
      if (!student) {
        return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบข้อมูลผู้ใช้' });
      }

      const studentSnapshot = {
        degree_level:    student.degree_level,
        study_plan_code: student.study_plan_code,
        curriculum_year: student.curriculum_year,
      };

      const [advisorRows] = await db.query(
        `SELECT advisor_id, advisor_type
           FROM journal_watch.advisor_assignments
          WHERE student_id = ? AND is_active = TRUE`,
        [studentId]
      );

      const majorAdvisor = advisorRows.find(a => a.advisor_type === 'Major');
      const co1Advisor   = advisorRows.find(a => a.advisor_type === 'Co_1');
      const co2Advisor   = advisorRows.find(a => a.advisor_type === 'Co_2');

      if (!majorAdvisor) {
        return res.status(400).json({ success: false, code: 'NO_MAJOR_ADVISOR', message: 'ยังไม่มีอาจารย์ที่ปรึกษาหลัก' });
      }

      const issn = journal_snapshot.issn;

      const t3Id = await T3Model.create(
        studentId,
        pre_t3_id,
        issn,
        journal_snapshot,
        studentSnapshot,
        paper_and_research_details,
        publication_details,
        journal_metrics,
        {
          majorAdvisorId: majorAdvisor.advisor_id,
          coAdvisor1Id:   co1Advisor?.advisor_id || null,
          coAdvisor2Id:   co2Advisor?.advisor_id || null,
        }
      );

      // --- จัดการไฟล์ (ถ้ามี) ---
      const evidenceFiles = {};
      const uploaded = {};

      if (req.files && Object.keys(req.files).length > 0) {
        for (const [fieldName, fileArr] of Object.entries(req.files)) {
          const key = FIELD_TO_KEY[fieldName];
          if (!key) continue;

          const file     = fileArr[0];
          const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
          const filename = `${Date.now()}_${safeName}`;
          const dir      = path.join(process.cwd(), 'uploads', 't3', String(t3Id), fieldName);

          fs.mkdirSync(dir, { recursive: true });
          const filePath     = path.join(dir, filename);
          fs.writeFileSync(filePath, file.buffer);

          const relativePath   = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
          evidenceFiles[key]   = relativePath;
          uploaded[fieldName]  = relativePath;
        }

        await db.query(
          `UPDATE journal_watch.t3_requests
              SET journal_evidence_files = ?
            WHERE t3_id = ?`,
          [JSON.stringify(evidenceFiles), t3Id]
        );
      }

      // แจ้ง Advisor ทางอีเมล
      const advisorUser = await UserModel.findById(majorAdvisor.advisor_id);
      if (advisorUser) {
        await MailService.sendT3Notification(advisorUser.msu_mail, 'advisor_pending', {
          studentName:  `${student.first_name} ${student.last_name}`,
          journalName:  journal_snapshot.journal_name,
          articleTitle: paper_and_research_details.title_english || paper_and_research_details.title_thai,
          t3Id,
        });
      }

      const uploadedCount = Object.keys(uploaded).length;
      return res.status(201).json({
        success: true,
        message: uploadedCount > 0
          ? `ยื่น T3 และอัปโหลด ${uploadedCount} ไฟล์สำเร็จ กรุณารอการอนุมัติจากอาจารย์ที่ปรึกษา`
          : 'ยื่น T3 สำเร็จ กรุณารอการอนุมัติจากอาจารย์ที่ปรึกษา',
        data: {
          t3_id:    t3Id,
          uploaded: uploadedCount > 0 ? uploaded : undefined,
        },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.submitWithFiles');
    }
  }

  // ============================================================
  // GET /api/t3/history
  // Role: Supervisor — ดูประวัติที่ตัวเองเคยอนุมัติ/ปฏิเสธแล้ว
  // Query: ?status=Approved|Rejected  ?page=1  ?limit=20
  // ============================================================
  static async getAdvisorHistory(req, res) {
    try {
      const advisorId = req.user.sub;
      const status    = ['Approved', 'Rejected'].includes(req.query.status) ? req.query.status : null;
      const page      = Math.max(1, parseInt(req.query.page)  || 1);
      const limit     = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

      const { rows, total } = await T3Model.findReviewedByAdvisor(advisorId, { status, page, limit });

      return res.json({
        success: true,
        data: {
          items:      rows.map(r => T3Controller._formatRow(r)),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      return serverError(res, err, 'T3Controller.getAdvisorHistory');
    }
  }

  // ============================================================
  // Helper
  // ============================================================
  static _formatRow(row) {
    const parseJson = (val) => {
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    };

    return {
      t3_id:                      row.t3_id,
      pre_t3_id:                  row.pre_t3_id,
      student_id:                 row.student_id,
      student_name:               row.first_name ? `${row.first_name} ${row.last_name}` : undefined,
      student_email:              row.msu_mail,
      issn:                       row.issn,
      overall_status:             row.overall_status,
      journal_snapshot:           parseJson(row.journal_snapshot),
      student_snapshot:           parseJson(row.student_snapshot),
      paper_and_research_details: parseJson(row.paper_and_research_details),
      publication_details:        parseJson(row.publication_details),
      journal_metrics:            parseJson(row.journal_metrics),
      journal_evidence_files:     parseJson(row.journal_evidence_files),
      advisor_approval:           parseJson(row.advisor_approval),
      co_advisor_1_approval:      parseJson(row.co_advisor_1_approval),
      co_advisor_2_approval:      parseJson(row.co_advisor_2_approval),
      faculty_com_approval:       parseJson(row.faculty_com_approval),
      grad_school_approval:       parseJson(row.grad_school_approval),
      submission_date:            row.submission_date,
      submission_round_cutoff:    row.submission_round_cutoff,
      created_at:                 row.created_at,
      updated_at:                 row.updated_at,
    };
  }
}

module.exports = T3Controller;