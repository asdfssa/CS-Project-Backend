-- Migration 001: Performance indexes + generated columns for JSON approval fields
-- วิธีรัน: กด F5 (Execute Script) ใน DBeaver เพื่อรันทีละ statement อัตโนมัติ
--
-- หมายเหตุ: ถ้า Error 1061 (Duplicate key name) ให้ข้ามได้เลย
--           แปลว่า index นั้นมีอยู่แล้ว ไม่ต้องทำซ้ำ
--
-- หมายเหตุ: ถ้า Error 1060 (Duplicate column name) ให้ข้ามได้เลย
--           แปลว่า column นั้นถูก add ไปแล้วจากการรัน migration ครั้งก่อน

-- ============================================================
-- STEP 1: Add generated columns (แยกจาก index เพื่อกัน rollback)
-- ============================================================
ALTER TABLE journal_watch.t3_requests
  ADD COLUMN adv_user_id    INT UNSIGNED GENERATED ALWAYS AS
    (CAST(JSON_UNQUOTE(JSON_EXTRACT(advisor_approval,      '$.user_id')) AS UNSIGNED)) STORED,
  ADD COLUMN adv_status     VARCHAR(20)  GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(advisor_approval,           '$.status'))) STORED,
  ADD COLUMN co1_user_id    INT UNSIGNED GENERATED ALWAYS AS
    (CAST(JSON_UNQUOTE(JSON_EXTRACT(co_advisor_1_approval, '$.user_id')) AS UNSIGNED)) STORED,
  ADD COLUMN co1_status     VARCHAR(20)  GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(co_advisor_1_approval,      '$.status'))) STORED,
  ADD COLUMN co2_user_id    INT UNSIGNED GENERATED ALWAYS AS
    (CAST(JSON_UNQUOTE(JSON_EXTRACT(co_advisor_2_approval, '$.user_id')) AS UNSIGNED)) STORED,
  ADD COLUMN co2_status     VARCHAR(20)  GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(co_advisor_2_approval,      '$.status'))) STORED,
  ADD COLUMN faculty_status VARCHAR(20)  GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(faculty_com_approval,       '$.status'))) STORED;

-- ============================================================
-- STEP 2: Indexes บน generated columns ใหม่ (ไม่มีทางซ้ำ)
-- ============================================================
ALTER TABLE journal_watch.t3_requests
  ADD INDEX idx_t3_adv_user_status (adv_user_id, adv_status),
  ADD INDEX idx_t3_co1_user_status (co1_user_id, co1_status),
  ADD INDEX idx_t3_co2_user_status (co2_user_id, co2_status),
  ADD INDEX idx_t3_faculty_status  (faculty_status);

-- ============================================================
-- STEP 3: Indexes บน column เดิม — รันแยก ถ้า Error 1061 ข้ามได้
-- ============================================================
ALTER TABLE journal_watch.t3_requests  ADD INDEX idx_t3_overall_status  (overall_status);
ALTER TABLE journal_watch.t3_requests  ADD INDEX idx_t3_student_id      (student_id);

ALTER TABLE journal_watch.users        ADD INDEX idx_users_msu_mail       (msu_mail);
ALTER TABLE journal_watch.users        ADD INDEX idx_users_deleted_at     (deleted_at);
ALTER TABLE journal_watch.users        ADD INDEX idx_users_account_status (account_status);
ALTER TABLE journal_watch.users        ADD INDEX idx_users_role           (role);

ALTER TABLE journal_watch.pre_t3_requests   ADD INDEX idx_pre_t3_student_id     (student_id);
ALTER TABLE journal_watch.pre_t3_requests   ADD INDEX idx_pre_t3_overall_status (overall_status);

ALTER TABLE journal_watch.advisor_assignments  ADD INDEX idx_advisor_student_id (student_id);
ALTER TABLE journal_watch.advisor_assignments  ADD INDEX idx_advisor_advisor_id (advisor_id);

ALTER TABLE journal_watch.otp_requests     ADD INDEX idx_otp_user_purpose (user_id, purpose);
ALTER TABLE journal_watch.refresh_tokens   ADD INDEX idx_refresh_user_id  (user_id);
