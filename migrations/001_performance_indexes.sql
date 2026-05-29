-- Migration 001: Performance indexes + generated columns for JSON approval fields
-- Run once against the journal_watch database.
-- Safe to run on empty or existing data.
--
-- วิธีรัน: เลือกทีละ ALTER TABLE แล้วกด Ctrl+Enter (Execute Statement)
-- หรือกด F5 (Execute Script) เพื่อรันทั้งไฟล์พร้อมกัน

-- ============================================================
-- t3_requests: Generated columns + indexes รวมใน statement เดียว
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
    (JSON_UNQUOTE(JSON_EXTRACT(faculty_com_approval,       '$.status'))) STORED,
  ADD INDEX idx_t3_adv_user_status (adv_user_id,  adv_status),
  ADD INDEX idx_t3_co1_user_status (co1_user_id,  co1_status),
  ADD INDEX idx_t3_co2_user_status (co2_user_id,  co2_status),
  ADD INDEX idx_t3_faculty_status  (faculty_status),
  ADD INDEX idx_t3_overall_status  (overall_status),
  ADD INDEX idx_t3_student_id      (student_id);

-- ============================================================
-- users
-- ============================================================
ALTER TABLE journal_watch.users
  ADD INDEX idx_users_msu_mail       (msu_mail),
  ADD INDEX idx_users_deleted_at     (deleted_at),
  ADD INDEX idx_users_account_status (account_status),
  ADD INDEX idx_users_role           (role);

-- ============================================================
-- pre_t3_requests
-- ============================================================
ALTER TABLE journal_watch.pre_t3_requests
  ADD INDEX idx_pre_t3_student_id     (student_id),
  ADD INDEX idx_pre_t3_overall_status (overall_status);

-- ============================================================
-- advisor_assignments
-- ============================================================
ALTER TABLE journal_watch.advisor_assignments
  ADD INDEX idx_advisor_student_id (student_id),
  ADD INDEX idx_advisor_advisor_id (advisor_id);

-- ============================================================
-- otp_requests / refresh_tokens
-- ============================================================
ALTER TABLE journal_watch.otp_requests
  ADD INDEX idx_otp_user_purpose (user_id, purpose);

ALTER TABLE journal_watch.refresh_tokens
  ADD INDEX idx_refresh_user_id (user_id);
