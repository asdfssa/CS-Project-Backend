-- ============================================================
-- DATABASE SCHEMA: JOURNAL WATCH (Version: v5)
-- ระบบตรวจสอบฐานข้อมูลสโคปัสและทีซีไอเพื่อการเผยแพร่ผลงานวิจัย
-- มหาวิทยาลัยมหาสารคาม — คณะวิทยาการสารสนเทศ
-- ============================================================
-- การแก้ไขจาก v4:
--   1. เพิ่ม `resubmit_count` และ `last_rejected_at` ใน pre_t3_requests
--      เพื่อติดตามว่านิสิตยื่นซ้ำกี่ครั้งหลังถูก reject
--   2. เพิ่ม `grad_school_approval` ใน t3_requests
--      ให้ตรงกับ flow จริง: Staff อนุมัติ → บัณฑิตวิทยาลัยออกผลสุดท้าย
--   3. เพิ่ม `fetched_by` ใน journals_cache
--      เก็บ user_id ที่ trigger การ fetch ครั้งล่าสุด เพื่อ audit
--   4. เพิ่ม soft delete (`deleted_at`, `deleted_by`) ใน msu_unwanted_journals
--      เพื่อเก็บประวัติเมื่อเจ้าหน้าที่ลบวารสารออกจากลิสต์
-- ============================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS journal_watch
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE journal_watch;

DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS otp_requests;
DROP TABLE IF EXISTS system_logs;
DROP TABLE IF EXISTS email_notifications;
DROP TABLE IF EXISTS t3_requests;
DROP TABLE IF EXISTS pre_t3_requests;
DROP TABLE IF EXISTS msu_unwanted_journals;
DROP TABLE IF EXISTS journals_cache;
DROP TABLE IF EXISTS advisor_assignments;
DROP TABLE IF EXISTS users;

-- ============================================================
-- 1. users
-- ============================================================
-- การแยก concerns:
--   - username + password_hash : สำหรับ Admin/SuperAdmin login เท่านั้น
--   - msu_mail + oauth_*       : สำหรับ OAuth user (Student/Supervisor/Staff)
--                                 และใช้เป็น contact ของ Admin
--   - oauth_provider_id        : Stable ID จาก Google ที่ไม่เปลี่ยนแม้ user เปลี่ยน email
-- ============================================================
CREATE TABLE users (
    user_id            INT             NOT NULL AUTO_INCREMENT,

    -- ===== Login credentials (Admin only) =====
    username           VARCHAR(50)     NULL
                                       COMMENT 'Admin/SuperAdmin login — NULL สำหรับ OAuth user, lowercase only',
    password_hash      VARCHAR(255)    NULL
                                       COMMENT 'bcrypt hash — NULL สำหรับ OAuth user',

    -- ===== Contact + OAuth identifier =====
    msu_mail           VARCHAR(100)    NOT NULL
                                       COMMENT 'MSU Mail — ใช้ทั้ง OAuth match และ contact (เปลี่ยนได้)',
    oauth_provider     VARCHAR(20)     NULL
                                       COMMENT 'google — NULL สำหรับ Admin',
    oauth_provider_id  VARCHAR(255)    NULL
                                       COMMENT 'Stable ID จาก Google (ไม่เปลี่ยนแม้ user เปลี่ยน email)',

    -- ===== Role + profile =====
    role               ENUM(
                           'Student',
                           'Supervisor',
                           'Program_Chair',
                           'Staff',
                           'Admin',
                           'SuperAdmin'
                       )               NOT NULL,
    prefix             VARCHAR(50)     NULL,
    first_name         VARCHAR(100)    NOT NULL,
    last_name          VARCHAR(100)    NOT NULL,
    degree_level       ENUM('Master','Doctoral') NULL,
    curriculum_year    ENUM('2560','2566')        NULL
                                       COMMENT 'เกณฑ์หลักสูตร พ.ศ. 2560 หรือ 2566',
    study_plan_code    ENUM(
                           'Master_A1','Master_A2','Master_B',
                           'Master_P1A1','Master_P1A2','Master_P2B',
                           'Doc_1_1','Doc_1_2','Doc_2_1','Doc_2_2',
                           'Doc_P1_1_1','Doc_P1_1_2','Doc_P2_2_1','Doc_P2_2_2'
                       )               NULL
                                       COMMENT 'รหัสแผนการศึกษาตามหลักสูตร',
    phone              VARCHAR(20)     NULL,
    facebook_id        VARCHAR(100)    NULL,
    line_id            VARCHAR(100)    NULL,

    -- ===== Account status =====
    account_status     ENUM('Pending','Active','Suspended')
                                       NOT NULL DEFAULT 'Pending'
                                       COMMENT 'Pending=รออนุมัติ, Active=ใช้งานได้, Suspended=ถูกระงับ',

    -- ===== Security tracking =====
    failed_login_attempts INT          NOT NULL DEFAULT 0
                                       COMMENT 'นับ failed login (reset เมื่อ login สำเร็จ)',
    locked_until          TIMESTAMP    NULL
                                       COMMENT 'ล็อคบัญชีจนถึงเวลานี้ (NULL = ไม่ล็อค)',
    last_login_at         TIMESTAMP    NULL
                                       COMMENT 'เวลา login สำเร็จล่าสุด',
    last_login_ip         VARCHAR(45)  NULL
                                       COMMENT 'IP ของ login ล่าสุด (รองรับ IPv6)',

    -- ===== Soft delete =====
    deleted_at         TIMESTAMP       NULL
                                       COMMENT 'NULL = active, มีค่า = ถูกลบแล้ว (เก็บไว้เพื่อ audit)',

    -- ===== Timestamps =====
    created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_username        (username),
    UNIQUE KEY uq_users_msu_mail        (msu_mail),
    UNIQUE KEY uq_users_oauth           (oauth_provider, oauth_provider_id),
    INDEX      idx_users_role           (role),
    INDEX      idx_users_account_status (account_status),
    INDEX      idx_users_deleted_at     (deleted_at),

    -- ===== Data integrity constraint =====
    -- Admin/SuperAdmin ต้องมี username + password_hash
    -- User อื่น (OAuth) ห้ามมี username + password_hash
    CONSTRAINT chk_login_method CHECK (
        (role IN ('Admin', 'SuperAdmin')
            AND username IS NOT NULL
            AND password_hash IS NOT NULL)
        OR
        (role NOT IN ('Admin', 'SuperAdmin')
            AND username IS NULL
            AND password_hash IS NULL
            AND oauth_provider IS NOT NULL
            AND oauth_provider_id IS NOT NULL)
    )

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. advisor_assignments
-- ============================================================
CREATE TABLE advisor_assignments (
    assignment_id  INT       NOT NULL AUTO_INCREMENT,
    student_id     INT       NOT NULL,
    advisor_id     INT       NOT NULL,
    advisor_type   ENUM('Major','Co_1','Co_2') NOT NULL,
    assigned_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active      BOOLEAN   NOT NULL DEFAULT TRUE,

    PRIMARY KEY (assignment_id),
    UNIQUE KEY uq_advisor_assignment (student_id, advisor_id, advisor_type),
    INDEX      idx_aa_student_id     (student_id),
    INDEX      idx_aa_advisor_id     (advisor_id),
    INDEX      idx_aa_is_active      (is_active),

    CONSTRAINT fk_aa_student
        FOREIGN KEY (student_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_aa_advisor
        FOREIGN KEY (advisor_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. journals_cache
-- ============================================================
-- [v5] เพิ่ม `fetched_by` เก็บ user_id ที่ trigger การ fetch ครั้งล่าสุด
--      เพื่อใช้ audit ว่าใครเป็นคน trigger และ debug ปัญหา cache ได้
-- ============================================================
CREATE TABLE journals_cache (
    issn                  VARCHAR(20)  NOT NULL,
    journal_name          VARCHAR(255) NOT NULL,
    database_source       ENUM('Scopus','TCI','Both') NOT NULL,
    scopus_quartile_data  JSON         NULL
                                       COMMENT 'JSON array ของทุก subject area และ quartile',
    scopus_best_quartile  VARCHAR(10)  NULL
                                       COMMENT 'quartile ที่ดีที่สุด เช่น Q1',
    scopus_h_index        INT          NULL,
    scopus_citescore      DECIMAL(5,2) NULL,
    scopus_sjr            DECIMAL(8,4) NULL,
    scopus_discontinued   BOOLEAN      NOT NULL DEFAULT FALSE,
    tci_tier              VARCHAR(10)  NULL,
    tci_h_index           INT          NULL,
    tci_subject_area      VARCHAR(255) NULL,
    tci_inactive          BOOLEAN      NOT NULL DEFAULT FALSE,
    subject_areas         JSON         NULL,
    fetch_method          ENUM('API','Scraping') NULL,

    -- [v5] เพิ่ม fetched_by: user_id ที่ trigger การ fetch ครั้งล่าสุด
    --      NULL = ระบบ auto-refresh เอง
    fetched_by            INT          NULL
                                       COMMENT 'user_id ที่ trigger fetch ครั้งล่าสุด, NULL = system auto-refresh',

    last_updated          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (issn),
    INDEX idx_jc_database_source (database_source),
    INDEX idx_jc_last_updated    (last_updated),
    INDEX idx_jc_fetched_by      (fetched_by),

    CONSTRAINT fk_jc_fetched_by
        FOREIGN KEY (fetched_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. msu_unwanted_journals
-- ============================================================
-- [v5] เพิ่ม soft delete: `deleted_at` และ `deleted_by`
--      เพื่อเก็บประวัติเมื่อเจ้าหน้าที่ลบวารสารออกจากลิสต์
--      ไม่ลบออกจริงจาก DB เพื่อ audit ย้อนหลังได้
-- ============================================================
CREATE TABLE msu_unwanted_journals (
    unwanted_id         INT          NOT NULL AUTO_INCREMENT,
    issn                VARCHAR(20)  NULL,
    journal_name        VARCHAR(255) NOT NULL,
    publisher           VARCHAR(255) NULL,
    note                TEXT         NULL,
    evidence_file_path  VARCHAR(255) NULL,
    recorded_date       DATE         NOT NULL,
    created_by          INT          NOT NULL
                                     COMMENT 'Staff ที่เพิ่มวารสารเข้าลิสต์',

    -- [v5] Soft delete fields
    deleted_at          TIMESTAMP    NULL
                                     COMMENT 'NULL = ยังอยู่ในลิสต์, มีค่า = ถูกลบออกแล้ว',
    deleted_by          INT          NULL
                                     COMMENT 'Staff ที่ลบวารสารออกจากลิสต์',

    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                              ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (unwanted_id),
    INDEX idx_muj_issn         (issn),
    INDEX idx_muj_journal_name (journal_name),
    INDEX idx_muj_created_by   (created_by),
    INDEX idx_muj_deleted_at   (deleted_at),

    CONSTRAINT fk_muj_created_by
        FOREIGN KEY (created_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_muj_deleted_by
        FOREIGN KEY (deleted_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. pre_t3_requests
-- ============================================================
-- JSON columns:
--   journal_snapshot      : issn, journal_name, journal_url, indexed_database,
--                           quartile_or_tier, is_discontinued, is_hijacked
--   student_snapshot      : degree_level, study_plan_code, curriculum_year
--   checklist_data        : item1–item9 (true/false)
--   advisor_approval      : status, user_id, remark, approved_at
--   co_advisor_1_approval : status(N/A|Pending|Approved|Rejected), user_id, remark, approved_at
--   co_advisor_2_approval : status(N/A|Pending|Approved|Rejected), user_id, remark, approved_at
--   program_chair_approval: status, user_id, remark, approved_at
--   faculty_com_approval  : status, meeting_no, meeting_date, remark, approved_at
--
-- [v5] เพิ่ม:
--   resubmit_count   : นับจำนวนครั้งที่นิสิตยื่นซ้ำหลังถูก reject
--   last_rejected_at : timestamp ของการ reject ครั้งล่าสุด เพื่อ audit และแสดงประวัติ
-- ============================================================
CREATE TABLE pre_t3_requests (
    pre_t3_id               INT       NOT NULL AUTO_INCREMENT,
    student_id              INT       NOT NULL,
    journal_snapshot        JSON      NOT NULL
                                      COMMENT 'issn, journal_name, journal_url, indexed_database, quartile_or_tier, is_discontinued, is_hijacked',
    student_snapshot        JSON      NOT NULL
                                      COMMENT 'degree_level, study_plan_code, curriculum_year',
    checklist_data          JSON      NOT NULL
                                      COMMENT 'item1–item9: true/false',
    advisor_approval        JSON      NOT NULL
                                      COMMENT 'status, user_id, remark, approved_at',
    co_advisor_1_approval   JSON      NOT NULL
                                      COMMENT 'status(N/A|Pending|Approved|Rejected), user_id, remark, approved_at',
    co_advisor_2_approval   JSON      NOT NULL
                                      COMMENT 'status(N/A|Pending|Approved|Rejected), user_id, remark, approved_at',
    program_chair_approval  JSON      NOT NULL
                                      COMMENT 'status, user_id, remark, approved_at',
    faculty_com_approval    JSON      NOT NULL
                                      COMMENT 'status, meeting_no, meeting_date, remark, approved_at',
    overall_status          ENUM('Pending','Approved','Rejected')
                                      NOT NULL DEFAULT 'Pending',

    -- [v5] Resubmission tracking
    resubmit_count          INT       NOT NULL DEFAULT 0
                                      COMMENT 'จำนวนครั้งที่ยื่นซ้ำหลังถูก reject (เริ่มที่ 0 = ยื่นครั้งแรก)',
    last_rejected_at        TIMESTAMP NULL
                                      COMMENT 'timestamp ของการ reject ครั้งล่าสุด, NULL = ยังไม่เคยถูก reject',

    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                                               ON UPDATE CURRENT_TIMESTAMP,

    -- Generated column เพื่อ index ISSN จาก JSON ได้เร็ว
    issn_virtual            VARCHAR(20) GENERATED ALWAYS AS
                                (JSON_UNQUOTE(JSON_EXTRACT(journal_snapshot, '$.issn')))
                                VIRTUAL,

    PRIMARY KEY (pre_t3_id),
    INDEX idx_pt3_student_id      (student_id),
    INDEX idx_pt3_overall_status  (overall_status),
    INDEX idx_pt3_issn            (issn_virtual),
    INDEX idx_pt3_created_at      (created_at),
    INDEX idx_pt3_resubmit_count  (resubmit_count),

    CONSTRAINT fk_pt3_student
        FOREIGN KEY (student_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 6. t3_requests
-- ============================================================
-- JSON columns:
--   journal_snapshot            : issn, journal_name
--   student_snapshot            : degree_level, study_plan_code, curriculum_year
--   paper_and_research_details  : title_thai, title_english, first_author,
--                                 corresponding_author, innovation_type, innovation_detail
--   publication_details         : type, weight_score, specified_database,
--                                 status, volume, issue, publish_year
--   journal_metrics             : has_impact_score, impact_factor, citescore, score_year
--   journal_evidence_files      : acceptance_letter_path, full_paper_path,
--                                 journal_cover_path, table_of_contents_path,
--                                 database_evidence_path, peer_review_result_path
--   advisor_approval            : status, user_id, remark, approved_at
--   co_advisor_1_approval       : status(N/A|Pending|Approved|Rejected), user_id, remark, approved_at
--   co_advisor_2_approval       : status(N/A|Pending|Approved|Rejected), user_id, remark, approved_at
--   faculty_com_approval        : status, meeting_no, meeting_date, remark, approved_at
--
-- [v5] เพิ่ม `grad_school_approval`:
--      ตาม flow จริงของ T3 บัณฑิตวิทยาลัยเป็นผู้ออกผลสุดท้าย
--      (ผ่านอีเมล researchpublication@msu.ac.th ตามฟอร์มจริง)
--      JSON structure: status, remark, approved_by_email, approved_at
-- ============================================================
CREATE TABLE t3_requests (
    t3_id                       INT          NOT NULL AUTO_INCREMENT,
    pre_t3_id                   INT          NOT NULL
                                             COMMENT 'T3 ต้องมี Pre-T3 ที่ Approved ก่อนเสมอ',
    student_id                  INT          NOT NULL,
    issn                        VARCHAR(20)  NOT NULL
                                             COMMENT 'ไว้นอก JSON เพื่อ lookup journals_cache ได้เร็ว',
    journal_snapshot            JSON         NOT NULL
                                             COMMENT 'issn, journal_name',
    student_snapshot            JSON         NOT NULL
                                             COMMENT 'degree_level, study_plan_code, curriculum_year',
    paper_and_research_details  JSON         NOT NULL
                                             COMMENT 'title_thai, title_english, first_author, corresponding_author, innovation_type, innovation_detail',
    publication_details         JSON         NOT NULL
                                             COMMENT 'type, weight_score, specified_database, status, volume, issue, publish_year',
    journal_metrics             JSON         NOT NULL
                                             COMMENT 'has_impact_score, impact_factor, citescore, score_year',
    journal_evidence_files      JSON         NOT NULL
                                             COMMENT 'acceptance_letter_path, full_paper_path, journal_cover_path, table_of_contents_path, database_evidence_path, peer_review_result_path',
    advisor_approval            JSON         NOT NULL
                                             COMMENT 'status, user_id, remark, approved_at',
    co_advisor_1_approval       JSON         NOT NULL
                                             COMMENT 'status(N/A|Pending|Approved|Rejected), user_id, remark, approved_at',
    co_advisor_2_approval       JSON         NOT NULL
                                             COMMENT 'status(N/A|Pending|Approved|Rejected), user_id, remark, approved_at',
    faculty_com_approval        JSON         NOT NULL
                                             COMMENT 'status, meeting_no, meeting_date, remark, approved_at',

    -- [v5] เพิ่ม grad_school_approval ให้ครบ flow จริงของ T3
    --      บัณฑิตวิทยาลัยเป็นผู้ออกผลขั้นสุดท้าย ผ่านทางอีเมล
    grad_school_approval        JSON         NOT NULL
                                             COMMENT 'status(Pending|Approved|Rejected), remark, approved_by_email, approved_at',

    overall_status              ENUM('Pending','Approved','Rejected')
                                             NOT NULL DEFAULT 'Pending',
    submission_date             DATE         NULL
                                             COMMENT 'วันที่ยื่นจริง',
    submission_round_cutoff     VARCHAR(10)  NULL
                                             COMMENT 'รอบที่ตัด เช่น 2568-04 = รอบเมษายน 2568',
    created_at                  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                      ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (t3_id),
    INDEX idx_t3_student_id         (student_id),
    INDEX idx_t3_pre_t3_id          (pre_t3_id),
    INDEX idx_t3_issn               (issn),
    INDEX idx_t3_overall_status     (overall_status),
    INDEX idx_t3_submission_date    (submission_date),
    INDEX idx_t3_created_at         (created_at),

    CONSTRAINT fk_t3_pre_t3
        FOREIGN KEY (pre_t3_id) REFERENCES pre_t3_requests (pre_t3_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_t3_student
        FOREIGN KEY (student_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 7. email_notifications
-- ============================================================
CREATE TABLE email_notifications (
    notif_id      INT                 NOT NULL AUTO_INCREMENT,
    user_id       INT                 NOT NULL,
    request_type  ENUM('Pre_T3','T3') NOT NULL,
    request_id    INT                 NOT NULL
                                      COMMENT 'polymorphic: pre_t3_id หรือ t3_id ตาม request_type',
    event         VARCHAR(100)        NOT NULL
                                      COMMENT 'เช่น advisor_approved, faculty_rejected, grad_school_approved',
    sent_at       TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_success    BOOLEAN             NOT NULL,
    error_message TEXT                NULL,

    PRIMARY KEY (notif_id),
    INDEX idx_en_user_id     (user_id),
    INDEX idx_en_request     (request_type, request_id),
    INDEX idx_en_sent_at     (sent_at),

    CONSTRAINT fk_en_user
        FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 8. system_logs
-- ============================================================
CREATE TABLE system_logs (
    log_id      INT          NOT NULL AUTO_INCREMENT,
    user_id     INT          NULL     COMMENT 'NULL = system action',
    action      VARCHAR(255) NOT NULL,
    target_type VARCHAR(50)  NULL     COMMENT 'เช่น pre_t3, t3, user, unwanted_journal, journal_cache',
    target_id   VARCHAR(50)  NULL,
    detail      JSON         NULL,
    ip_address  VARCHAR(45)  NOT NULL,
    user_agent  VARCHAR(500) NULL     COMMENT 'browser/client info สำหรับ forensic',
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (log_id),
    INDEX idx_sl_user_id     (user_id),
    INDEX idx_sl_created_at  (created_at),
    INDEX idx_sl_action      (action),
    INDEX idx_sl_target      (target_type, target_id),

    CONSTRAINT fk_sl_user
        FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 9. otp_requests
-- ============================================================
-- การออกแบบ:
--   - Hash OTP ก่อนเก็บ (เหมือน password) ป้องกัน DB leak
--   - รองรับหลาย purpose (login_2fa, password_reset, email_verify)
--   - เก็บ history ไว้ทำ rate limit + audit trail
--   - ไม่มี phone_number เพราะใช้ Email OTP
--   - เพิ่ม attempt_count เพื่อจำกัดจำนวนครั้งกรอกผิด
-- ============================================================
CREATE TABLE otp_requests (
    otp_id         INT          NOT NULL AUTO_INCREMENT,
    user_id        INT          NOT NULL,
    otp_hash       VARCHAR(255) NOT NULL
                                COMMENT 'SHA-256 hash ของ OTP (ไม่เก็บ plain text)',
    purpose        ENUM('login_2fa','password_reset','email_verify')
                                NOT NULL
                                COMMENT 'วัตถุประสงค์ของ OTP',
    expires_at     TIMESTAMP    NOT NULL
                                COMMENT 'หมดอายุใน 5-10 นาที',
    used_at        TIMESTAMP    NULL
                                COMMENT 'NULL = ยังไม่ใช้, มีค่า = ใช้แล้ว (ห้ามใช้ซ้ำ)',
    attempt_count  INT          NOT NULL DEFAULT 0
                                COMMENT 'จำนวนครั้งที่กรอก OTP ผิด (lockout เมื่อเกิน 5)',
    ip_address     VARCHAR(45)  NULL
                                COMMENT 'IP ที่ขอ OTP',
    user_agent     VARCHAR(500) NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (otp_id),
    INDEX idx_otp_user_purpose  (user_id, purpose, used_at),
    INDEX idx_otp_expires_at    (expires_at),
    INDEX idx_otp_created_at    (created_at),

    CONSTRAINT fk_otp_user
        FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 10. password_reset_tokens
-- ============================================================
CREATE TABLE password_reset_tokens (
    token_id    INT          NOT NULL AUTO_INCREMENT,
    user_id     INT          NOT NULL COMMENT 'Admin หรือ SuperAdmin เท่านั้น',
    token_hash  VARCHAR(255) NOT NULL COMMENT 'SHA-256 hash ของ token ที่ส่งทางอีเมล',
    expires_at  TIMESTAMP    NOT NULL COMMENT 'หมดอายุใน 15 นาที',
    used_at     TIMESTAMP    NULL     COMMENT 'NULL = ยังไม่ใช้, มีค่า = ใช้แล้ว',
    ip_address  VARCHAR(45)  NULL     COMMENT 'IP ที่ขอ reset',
    user_agent  VARCHAR(500) NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (token_id),	
    UNIQUE KEY uq_prt_token_hash  (token_hash),
    INDEX      idx_prt_user_id    (user_id),
    INDEX      idx_prt_expires_at (expires_at),

    CONSTRAINT fk_prt_user
        FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

ALTER TABLE journal_watch.journals_cache 
  MODIFY scopus_citescore DECIMAL(10,2) NULL,
  MODIFY scopus_sjr DECIMAL(10,4) NULL;

ALTER TABLE journal_watch.journals_cache
  ADD COLUMN publisher            VARCHAR(255) NULL AFTER journal_name,
  ADD COLUMN scopus_snip          DECIMAL(10,4) NULL AFTER scopus_sjr,
  ADD COLUMN scopus_best_percentile INT NULL AFTER scopus_best_quartile,
  ADD COLUMN coverage_start_year  VARCHAR(10) NULL AFTER scopus_discontinued,
  ADD COLUMN coverage_end_year    VARCHAR(10) NULL AFTER coverage_start_year;

ALTER TABLE journal_watch.journals_cache
  ADD COLUMN eissn            VARCHAR(20)  NULL AFTER issn,
  ADD COLUMN journal_name_th  VARCHAR(255) NULL AFTER journal_name,
  ADD COLUMN publisher_th     VARCHAR(255) NULL AFTER publisher,
  ADD COLUMN website          VARCHAR(255) NULL AFTER publisher_th,
  ADD COLUMN abbrev_name      VARCHAR(100) NULL AFTER website,
  ADD COLUMN tci_status       VARCHAR(50)  NULL AFTER tci_inactive,
  ADD COLUMN minor_area       VARCHAR(255) NULL AFTER tci_subject_area,
  ADD COLUMN issue_per_volume VARCHAR(20)  NULL AFTER minor_area;

ALTER TABLE journal_watch.journals_cache
  ADD COLUMN main_area       VARCHAR(100) NULL AFTER minor_area,
  ADD COLUMN volume_per_year VARCHAR(20)  NULL AFTER issue_per_volume,
  ADD COLUMN prev_name       VARCHAR(255) NULL AFTER volume_per_year,
  ADD COLUMN prev_name_th    VARCHAR(255) NULL AFTER prev_name;


CREATE TABLE journal_watch.refresh_tokens (
    token_id    INT          NOT NULL AUTO_INCREMENT,
    user_id     INT          NOT NULL,
    token_hash  VARCHAR(255) NOT NULL COMMENT 'SHA-256 hash ของ refresh token',
    expires_at  TIMESTAMP    NOT NULL,
    revoked_at  TIMESTAMP    NULL     COMMENT 'NULL = ยังใช้ได้, มีค่า = ถูก revoke แล้ว',
    ip_address  VARCHAR(45)  NULL,
    user_agent  VARCHAR(500) NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (token_id),
    UNIQUE KEY uq_rt_token_hash (token_hash),
    INDEX idx_rt_user_id    (user_id),
    INDEX idx_rt_expires_at (expires_at),

    CONSTRAINT fk_rt_user
        FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE journal_watch.pre_t3_requests
  ADD COLUMN article_info JSON NULL
    COMMENT 'title_en, title_th, authors, publish_year, doi, abstract'
  AFTER checklist_data;


ALTER TABLE journal_watch.pre_t3_requests
  ADD COLUMN student_info JSON NULL
    COMMENT 'snapshot ข้อมูลนิสิต ณ วันที่ยื่น'
  AFTER checklist_data,
  ADD COLUMN advisor_info JSON NULL
    COMMENT 'snapshot ข้อมูลอาจารย์ที่ปรึกษา ณ วันที่ยื่น'
  AFTER student_info;

ALTER TABLE journal_watch.users
  ADD COLUMN faculty    varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'คณะ'    AFTER `last_name`,
  ADD COLUMN department varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'สาขาวิชา' AFTER `faculty`;
-- ============================================================
-- END OF SCHEMA
-- ============================================================