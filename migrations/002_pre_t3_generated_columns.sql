-- Migration 002: Generated columns for pre_t3_requests JSON approval fields
-- รันหลังจาก 001_performance_indexes.sql แล้วเท่านั้น
-- วิธีรัน: กด F5 (Execute Script) ใน DBeaver
--
-- หมายเหตุ: ถ้า Error 1060 (Duplicate column name) → column มีแล้ว ข้ามได้
--           ถ้า Error 1061 (Duplicate key name)    → index มีแล้ว ข้ามได้

-- STEP 1: Add generated columns
ALTER TABLE journal_watch.pre_t3_requests
  ADD COLUMN adv_user_id    INT UNSIGNED GENERATED ALWAYS AS
    (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(advisor_approval,      '$.user_id')), 'null') AS UNSIGNED)) STORED,
  ADD COLUMN adv_status     VARCHAR(20)  GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(advisor_approval,           '$.status'))) STORED,
  ADD COLUMN co1_user_id    INT UNSIGNED GENERATED ALWAYS AS
    (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(co_advisor_1_approval, '$.user_id')), 'null') AS UNSIGNED)) STORED,
  ADD COLUMN co1_status     VARCHAR(20)  GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(co_advisor_1_approval,      '$.status'))) STORED,
  ADD COLUMN co2_user_id    INT UNSIGNED GENERATED ALWAYS AS
    (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(co_advisor_2_approval, '$.user_id')), 'null') AS UNSIGNED)) STORED,
  ADD COLUMN co2_status     VARCHAR(20)  GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(co_advisor_2_approval,      '$.status'))) STORED,
  ADD COLUMN faculty_status VARCHAR(20)  GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(faculty_com_approval,       '$.status'))) STORED;

-- STEP 2: Indexes บน generated columns ใหม่
ALTER TABLE journal_watch.pre_t3_requests
  ADD INDEX idx_pre_t3_adv_user_status (adv_user_id, adv_status),
  ADD INDEX idx_pre_t3_co1_user_status (co1_user_id, co1_status),
  ADD INDEX idx_pre_t3_co2_user_status (co2_user_id, co2_status),
  ADD INDEX idx_pre_t3_faculty_status  (faculty_status);
