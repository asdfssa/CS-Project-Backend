-- Migration 001: Performance indexes + generated columns for JSON approval fields
-- Run once against the journal_watch database.
-- Safe to run on empty or existing data.

-- ============================================================
-- t3_requests: Generated columns for JSON approval fields
-- Allows indexed lookups instead of JSON_EXTRACT table scans
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

-- Composite indexes for advisor pending queries
CREATE INDEX idx_t3_adv_user_status ON journal_watch.t3_requests(adv_user_id,  adv_status);
CREATE INDEX idx_t3_co1_user_status ON journal_watch.t3_requests(co1_user_id,  co1_status);
CREATE INDEX idx_t3_co2_user_status ON journal_watch.t3_requests(co2_user_id,  co2_status);
CREATE INDEX idx_t3_faculty_status  ON journal_watch.t3_requests(faculty_status);
CREATE INDEX idx_t3_overall_status  ON journal_watch.t3_requests(overall_status);
CREATE INDEX idx_t3_student_id      ON journal_watch.t3_requests(student_id);

-- ============================================================
-- users
-- ============================================================
CREATE INDEX idx_users_msu_mail       ON journal_watch.users(msu_mail);
CREATE INDEX idx_users_deleted_at     ON journal_watch.users(deleted_at);
CREATE INDEX idx_users_account_status ON journal_watch.users(account_status);
CREATE INDEX idx_users_role           ON journal_watch.users(role);

-- ============================================================
-- pre_t3_requests
-- ============================================================
CREATE INDEX idx_pre_t3_student_id     ON journal_watch.pre_t3_requests(student_id);
CREATE INDEX idx_pre_t3_overall_status ON journal_watch.pre_t3_requests(overall_status);

-- ============================================================
-- advisor_assignments
-- ============================================================
CREATE INDEX idx_advisor_student_id ON journal_watch.advisor_assignments(student_id);
CREATE INDEX idx_advisor_advisor_id ON journal_watch.advisor_assignments(advisor_id);

-- ============================================================
-- otp_requests / refresh_tokens
-- ============================================================
CREATE INDEX idx_otp_user_purpose  ON journal_watch.otp_requests(user_id, purpose);
CREATE INDEX idx_refresh_user_id   ON journal_watch.refresh_tokens(user_id);
