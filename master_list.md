# Master List — Journal Watch Backend

รวมงานทั้งหมดจากการวางแผนคุยกับที่ปรึกษา (schema simplification, cache removal, rate limit redesign)
รวมเข้ากับบั๊กที่เจอจาก TO_FIX.md (ไฟล์เดิมถูกลบแล้ว รวมเข้ามาที่นี่ทั้งหมด)

**ลำดับความสำคัญ: ทำ Section A (Master List) ให้เสร็จหมดก่อน แล้วค่อยมาไล่ Section B (Bug Fixes)**

ทุกครั้งที่แก้เสร็จ 1 ข้อ ให้ติ๊ก `[x]` และ commit+push ทันที (ตาม convention ของ repo นี้)

---

## Section A — Master List (ทำก่อน)

### A1. ตัด Journal Cache ทั้งระบบ
- [x] `ScopusService.js` — ตัด `_getFromCache()`/`_saveToCache()`/`_formatCachedResult()` + cache-check block ออก
- [x] `TCIService.js` — เหมือนกัน
- [x] `ScopusScraper.js` — เหมือนกัน
- [x] `TCIScraper.js` — เหมือนกัน
- [x] ตัด field `fromCache` ออกจากทุก response ของ 4 service ข้างบน
- [x] `JournalController._normalizeResponse()` — ตัด `fromCache` ออก
- [x] `AdminController.js` — ตัด dashboard stat ที่นับจาก `journals_cache` ออก
- [x] Migration: `DROP TABLE journals_cache` (แก้ที่ `db/init/001_schema.sql` โดยตรง — ยืนยันแล้วว่าไฟล์นี้คือ schema ที่ใช้จริงสำหรับ Pro2)

### A2. Scopus Rate Limit ออกแบบใหม่
- [ ] `.env` / `config/index.js` — ขยาย `SCOPUS_API_KEY_1..10` (จาก 3 → 10 keys)
- [ ] `ScopusProxyService.js` — เพิ่ม per-second throttle (5 req/วิ/key), ชน cap ข้าม key ทันที
- [ ] `ScopusProxyService.js` — เลิกนับ weekly quota เอง เปลี่ยนไปอ่านจาก header `X-RateLimit-Limit/Remaining/Reset` ของ Elsevier หลังทุก request
- [ ] `ScopusProxyService.js` — persist state ลงไฟล์ JSON บน disk (write-through) แทน RAM ล้วนๆ
- [ ] `ScopusProxyService.js` — เลิกใช้ `setInterval`/`setTimeout` เปลี่ยนเป็น lazy-check ใน `getNextKey()`
- [ ] `ScopusService.js` — แก้ call site ให้ await `getNextKey()`/`incrementUsage()`/`markKeyUnavailable()` (เปลี่ยนเป็น async)
- [ ] คง logic เดิม: 429 จริงที่หลุดรอด (หลัง throttle) ยัง block 1 ชม. เหมือนเดิม

### A3. ตัดระบบที่ไม่อยู่ใน proposal scope
- [ ] ลบ `BugReportModel.js`, `BugReportController.js`, `bugReportRoutes.js` ทั้งไฟล์
- [ ] `routes/index.js` — ตัดจุด register `bugReportRoutes`
- [ ] Migration: `DROP TABLE bug_reports`
- [ ] ลบ `SystemLogModel.js` ทั้งไฟล์
- [ ] `AdminController.js` — ตัด endpoint `GET /api/admin/logs` (`getLogs`)
- [ ] `AuthService.js` — ตัดทุกจุดที่เรียก `SystemLogModel.log(...)`
- [ ] Migration: `DROP TABLE system_logs`
- [ ] Migration: `DROP TABLE email_notifications` (ไม่มีโค้ดอ้างถึงเลย)

### A4. ตัด Login Lockout Tracking
- [ ] Migration: ตัด column `users.failed_login_attempts`, `locked_until`, `last_login_at`, `last_login_ip`
- [ ] `UserModel.js` — ลบ `isLocked()`, `incrementFailedAttempts()`
- [ ] `AuthService.login()` — ตัดจุดเรียก `isLocked()`/`incrementFailedAttempts()`

### A5. Soft-delete → Hard-delete
- [ ] `users.deleted_at` — เปลี่ยนทุก `UPDATE ... SET deleted_at = NOW()` เป็น `DELETE FROM users`
- [ ] ไล่ทุก `WHERE deleted_at IS NULL` ที่เกี่ยวกับ `users` ออก (เพราะแถวที่ลบจะหายไปเลย ไม่ต้อง filter)
- [ ] `msu_unwanted_journals.deleted_at`/`deleted_by` — เปลี่ยนเป็น hard delete เหมือนกัน
- [ ] ไล่ทุก `WHERE deleted_at IS NULL` ของ `msu_unwanted_journals` ออก
- [ ] เช็ค FK cascade/orphan record ที่อาจเกิดจากการ hard-delete `users` (เช่น `pre_t3_requests.student_id`, `advisor_assignments.advisor_id` ที่อ้างถึง user ที่โดนลบ)

### A6. ตัด Column ปลีกย่อย
- [ ] `advisor_assignments` — ตัด `assigned_at`
- [ ] `t3_evidence_files` — ตัด `uploaded_at`
- [ ] `request_approvals` — ตัด enum `'Program_Chair'` ออกจาก `step`, ตัด column `created_at`
- [ ] `auth_tokens` — ตัด `ip_address`, `user_agent`, `created_at`
- [ ] `otp_requests` — ตัด `ip_address`, `user_agent`
- [ ] `users` — ตัด `faculty`, `oauth_provider_id`, `updated_at`
- [ ] `msu_unwanted_journals` — ตัด `updated_at`
- [ ] `pre_t3_requests` — ตัด `degree_level`, `curriculum_year`, `study_plan_code` (join ผ่าน `users` แทน)
- [ ] `t3_requests` — ตัด `issn`, `journal_name`, `degree_level`, `curriculum_year`, `study_plan_code` (join ผ่าน `pre_t3_requests`/`users` แทน)
- [ ] `t3_requests` — ตัด `grad_school_status`, `grad_school_remark`, `grad_school_decided_at`, `grad_school_relayed_by`, `submission_date`, `submission_round_cutoff`
- [ ] แก้ query ทุกจุดที่ยังอ้าง column ที่ถูกตัดออกไป (SELECT/INSERT/response builder) ให้ join แทน
- [ ] `users.department` — **pending รอถามอาจารย์** ก่อนตัดสินใจ

### A7. ลบ Dead Code
- [ ] `T3Model.js` — ลบ `gradSchoolReview()`, `updateSubmissionDetails()`, `_buildGradSchoolApproval()` + จุดใช้ใน response object
- [ ] `T3Model.js` — ลบ `getEvidenceFiles()`
- [ ] `PreT3Model.create()` — ตัด parameter `studentInfo`/`advisorInfo` ที่ไม่ใช้แล้ว + comment เดิมที่อธิบายว่า unused
- [ ] `T3Controller.js` header comment — ตัดการอ้างอิง endpoint `grad-school-review` ที่ไม่มีจริง (มาจาก TO_FIX #13)

### A8. DB Cleanup Job ใหม่ (กัน DB บวม)
- [ ] `server.js` — เพิ่ม `setInterval` เรียก cleanup ทุก 24 ชม.
- [ ] ต่อ `RefreshTokenModel.deleteExpired()` เข้า interval นี้
- [ ] `OtpModel.js` — เขียนฟังก์ชันใหม่ `deleteExpired()` (ลบ `otp_requests` ที่ `expires_at < NOW()` และ `used_at IS NOT NULL` มานานแล้ว)
- [ ] ต่อ `OtpModel.deleteExpired()` เข้า interval เดียวกัน

### A9. ยังไม่ปิดจบ / รอข้อมูลเพิ่ม
- [ ] **ER Diagram** — รอนัด อ.ปนิดา
- [ ] **T3 ไม่มี resubmit endpoint** — ถามทีมว่าตั้งใจ (T3 reject ต้องยื่นใหม่ทั้งหมด) หรือเป็น feature ที่ยังไม่ได้ทำ

### A10. ข้อที่ตัดสินใจแล้ว (รอลงมือแก้โค้ด)
- [x] **`users.department`** — ตัดสินใจ**เก็บไว้** (ยืนยันว่าใช้งานจริง มี description "ภาควิชา/สาขาที่สังกัด" + ตัวอย่าง "สาขาวิทยาการคอมพิวเตอร์" อยู่แล้วในเอกสาร) — อัปเดต comment ใน `db_script/journal_watch_schema_v3.sql` แล้ว ไม่ต้องแก้โค้ดอะไรเพิ่ม
- [x] **`Program_Chair` role** — ตัดสินใจ**ตัดออก** จากเอกสาร (ตารางที่ 3.4 `users.role` enum) และ `journal_watch_schema_v3.sql` (`users.role` enum ไม่มีอยู่แล้ว) เรียบร้อยแล้ว
  - [ ] **ยังไม่แก้โค้ดจริง** — `UserModel.js`/`AuthService.js` (หรือไฟล์ที่มี `allowedRoles` ของ `createUser`/`importUsers`) ยังต้องตัด `'Program_Chair'` ออกจาก allowedRoles list ด้วย
- [ ] **pre-T3 auto-approve co-advisor** — ยืนยัน design แล้ว (ทำ auto-approve ต่อไปตาม logic เดิมใน `PreT3Model.js` ~418-419 ที่ถูกอยู่แล้ว) แต่ต้อง**แก้อีเมลที่ส่งให้ co-advisor**:
  - Flow: เมื่ออาจารย์ที่ปรึกษาหลัก (Major Advisor) อนุมัติ Pre-T3/T3 → ระบบ auto-approve ให้ co-advisor ทั้ง 2 คน (Co_Advisor_1, Co_Advisor_2 ถ้ามี) ทันที โดย co-advisor **ไม่ต้องกดอนุมัติเอง**
  - อีเมลที่ส่งให้ co-advisor (ตอนนิสิตยื่นคำร้อง) **ต้องไม่ใช่คำเชิญให้กดอนุมัติ** — เนื้อหาต้องแจ้งว่า "มีนิสิตยื่น Pre-T3/T3 แล้ว ขอให้ไปหารือกับอาจารย์ที่ปรึกษาหลัก (Major Advisor) ซึ่งจะเป็นผู้อนุมัติแทน"
  - **จุดที่ต้องแก้ในโค้ด**:
    - `MailService.js` — เพิ่ม event ใหม่ (เช่น `co_advisor_pending`) แยกจาก `advisor_pending` เดิม ที่ส่งให้ major advisor เท่านั้น เพราะเนื้อหาอีเมลต้องต่างกัน (major advisor = คำเชิญอนุมัติ, co-advisor = แจ้งให้ไปหารือ)
    - `PreT3Controller.submit()` (บรรทัด ~162-171) และ `T3Controller.submit()`/`submitWithFiles()` ที่เกี่ยวข้อง — ปัจจุบันส่งอีเมลแจ้งแค่ major advisor ตอนยื่นคำร้อง (ไม่มีการแจ้ง co-advisor เลย) ต้องเพิ่มส่งอีเมล event ใหม่ให้ co-advisor ทั้ง 2 คนด้วย (ถ้ามี) พร้อมกับตอนที่ส่งให้ major advisor
    - เช็คว่า `PreT3Controller.resubmit()` (บรรทัด ~444-457) ต้องส่งอีเมลแบบเดียวกันซ้ำตอนยื่นใหม่ด้วยไหม
- [ ] **pre-T3 Checklist 9 ข้อ — ตัด Auto-check ออก ให้นิสิตติ๊กเองทั้งหมด** — ตัดสินใจแล้ว: ไม่ให้ระบบ auto-tick รายการใดๆ ให้อีก แม้จะมีข้อมูลจากผลค้นหาอยู่แล้วก็ตาม (เดิมมีบางข้อ auto-check ให้ตามเงื่อนไข เช่น ชื่อวารสารตรง, ยังไม่ Discontinued) — นิสิตต้องกดยืนยันเองครบทั้ง 9 ข้อก่อนยื่นคำร้องได้เสมอ
  - **นี่คือฝั่ง Frontend (Angular)** ไม่ใช่ backend repo นี้ — จุดที่ต้องแก้ (พบตอนอ่านเอกสารธีสิสเดิม ก่อนลบหัวข้ออธิบายออกเพราะยังไม่ได้ข้อสรุป):
    - Component ฟอร์ม Pre-T3 — ฟังก์ชัน `auto(id, cond)` ที่ auto-tick ตามเงื่อนไข (ข้อ 1, 3, 4, 5, 6, 7, 9 และข้อ 8 แบบมีเงื่อนไข) ต้องตัดออก เหลือใช้ `ms(id)` (manual, ต้องให้นิสิตติ๊กเอง) กับทุกข้อแทน
    - `ngOnInit()` ที่ทำ Pre-check รายการ Checklist อัตโนมัติตอนมาจากหน้าค้นหา (มี `state.journalName`) — ต้องตัดส่วน pre-check checklist ออก (ส่วนเติมข้อมูลฟอร์มอัตโนมัติอื่นๆ เช่น ชื่อวารสาร/ข้อมูลนิสิต/อาจารย์ที่ปรึกษา ยังคงอัตโนมัติได้เหมือนเดิม ตัดเฉพาะส่วน checklist)
    - `canSubmit` ยังคงเงื่อนไขเดิม (ต้องผ่านครบทุกข้อ + มี ISSN + รหัสนิสิต) แค่เปลี่ยนที่มาของสถานะแต่ละข้อเป็น manual ทั้งหมด

---

## Section B — Bug Fixes (ทำหลัง Section A เสร็จหมดแล้วเท่านั้น)

รวมจาก TO_FIX.md เดิม — ตัดข้อที่ moot ไปแล้วเพราะไฟล์/ฟีเจอร์ที่บั๊กอยู่ถูกลบทิ้งใน Section A ออก
(ข้อที่ตัดออกไป: BugReportController leak err.message, โค้ดซ้ำ cache 4 ไฟล์, `TCIScraper._formatCachedResult` ทิ้ง field, ScopusProxyService in-memory — ทั้งหมดนี้แก้ทางอ้อมจาก Section A แล้ว)

### 🔴 Critical — Security exploit ได้จริงตอนนี้
- [ ] **Stored XSS ผ่านไฟล์อัปโหลดที่ปลอม MIME type**
  - `middlewares/upload.js` — `filename()`: คำนวณ `ext` ไว้แต่ไม่ได้ใช้ ชื่อไฟล์เก็บนามสกุลเดิมเต็ม
  - `UploadController.downloadFile()` — `res.sendFile()` ไม่บังคับ `Content-Disposition: attachment`
  - `UnwantedJournalController.getEvidenceFile()`/`evidenceStorage`/`uploadEvidence` — ปัญหาเดียวกัน
  - ทางแก้: (1) บังคับ `Content-Disposition: attachment` เสมอ (2) บังคับ extension ให้ตรงกับ MIME ที่ผ่าน filter (3) เช็ค magic bytes ด้วย `file-type`

### ⚠️ Pre-deploy checklist
- [ ] `/api/v2/logs` เปิดสาธารณะไม่ต้อง login (`routes/logRoutes.js`) — guard ด้วย `NODE_ENV === 'production' → 404`

### 🟠 บั๊กกระทบข้อมูล/สิทธิ์
- [ ] `AuthService.js` — `const createdAt = new Date()` เป็น module-level (บรรทัด ~21) ย้ายเข้าไปในฟังก์ชัน `registerStaff`
- [ ] `AuthService.registerStaff` — bypass Model layer (query DB ตรงๆ แทนที่จะผ่าน `UserModel`)
- [ ] `UserController.updateProfile` — แก้ field เกิน scope (UPDATE `prefix`/`first_name`/`last_name` ทั้งที่ comment บอกห้าม) → ตัดออกให้เหลือแค่ `phone`/`facebook_id`/`line_id`
- [ ] `AdminController.suspendUser` (บรรทัด 210) — `req.user.userId` ผิด (JWT payload ไม่มี field นี้ มีแต่ `.sub`) → self-suspend guard เป็น `false` เสมอ
- [ ] `PreT3Model.resubmit()` — ไม่เช็ค `affectedRows` ก่อนรัน UPDATE ตัวที่สอง (reset approvals)
- [ ] `PreT3Controller.cancel()` / `T3Controller.cancel()` — ไม่เช็คค่า return จาก `Model.cancel()`
- [ ] `JournalController.proxyStatus` — ไม่มี try/catch/next
- [ ] `MailService._buildPreT3Html()`/`_buildOtpHtml()` — HTML injection จาก user input (`journal_name`, `remark`, ชื่อ user) ไม่ escape ก่อนแทรกเข้า template
- [ ] `UnwantedJournalController.createOne` — ternary ไม่มีความหมาย (`err.code === 'LIMIT_FILE_SIZE' ? 400 : 400`)

### 🟢 Cleanup / Refactor (ไม่กระทบ behavior)
- [ ] `T3Controller.submit()` กับ `submitWithFiles()` — โค้ดซ้ำ ~100 บรรทัด ควร extract shared validation helper
- [ ] `PreT3Model.js` กับ `T3Model.js` — โครงสร้างซ้ำ (`_attachDerived`, `_slotFromApproval`, `advisorReview` ฯลฯ) พิจารณา extract shared helper
- [ ] Documentation debt — comment อ้าง path/endpoint เก่าที่ไม่มีจริงแล้ว (`/api/admin/users/...` → `/api/manage/users/...`, `AdminController.deleteAdmin` comment บอก "hard delete" แต่เป็น soft delete — **หมายเหตุ: ถ้า A5 ทำ hard delete จริงแล้ว comment นี้จะถูกต้องเอง ไม่ต้องแก้**)
- [ ] ไม่มี database transaction ในจุดที่ควร atomic: `AdminController.importUsers`/`updateAdvisors`, `UnwantedJournalController.importCsv`, `PreT3Model`/`T3Model` `advisorReview`/`facultyReview`/`resubmit`
- [ ] `errorResponse.js`/`errorHandler.js` — hardcode `res.status(500)` เสมอ ทั้งที่ `MYSQL_ERRORS` map ไว้ละเอียดว่าควรเป็นคนละ status (เช่น `ER_DUP_ENTRY` → 409)
- [ ] `errorResponse.js` — `serverError()` ไม่มี special-case สำหรับ custom error class ที่พก statusCode มาเอง (ต่างจาก `errorHandler.js` ที่เช็ค `instanceof AuthError`)

### 🔵 ควรพิจารณา (ไม่ใช่บั๊ก แต่ควรตระหนัก)
- [ ] `TCIService`/`TCIScraper` — fallback `journals[0]` เมื่อไม่เจอ exact ISSN match อาจได้ข้อมูลวารสารผิดตัว
- [ ] `T3Controller.submitWithFiles` — sync `fs.writeFileSync` บล็อก event loop + ไม่มี rollback/duplicate-guard
- [ ] `T3Controller.normalizePublicationType` — default เป็น `National_TCI_Tier2` แบบเงียบๆ ถ้า parse ไม่ได้ (กระทบเครดิตนิสิตโดยตรง)
- [ ] `rateLimit.js` — rate limit ทั้งหมดขึ้นกับ `NODE_ENV === 'production'` เป๊ะๆ ตั้งผิดจะปิด brute-force protection แบบเงียบๆ
- [ ] Scraping endpoint (`/journal/*/scrape`) ไม่มี rate limiter ป้องกันยิงรัว (เปิด browser จริงทุกครั้ง)
- [ ] `MailService.transporter` เป็น `null` เงียบๆ ถ้า config mode ตั้งผิด — ควร validate ตอน startup
- [ ] noVNC ไม่มีรหัสผ่าน (`x11vnc -nopw`) + publish port ออกสู่ host (`docker-compose.yml`) — เช็ค firewall/router ว่า port 5900/5901/6080/6081 ไม่เปิดออกอินเทอร์เน็ตจริง

---

## หมายเหตุ
- `scopus_h_index: null` ใน `ScopusService.js`/`ScopusScraper.js` **ไม่ใช่บั๊ก** — ยืนยันแล้วว่า Scopus ไม่มีข้อมูลนี้ให้จริง ตั้งใจ hardcode ไว้
- ไฟล์นี้แทนที่ `TO_FIX.md` เดิม (ลบไปแล้ว) — รวมทุกอย่างไว้ที่นี่ที่เดียว
