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
- [x] `.env` / `config/index.js` — ขยาย `SCOPUS_API_KEY_1..10` (จาก 3 → 10 keys)
- [x] `ScopusProxyService.js` — เพิ่ม per-second throttle (5 req/วิ/key), ชน cap ข้าม key ทันที
- [x] `ScopusProxyService.js` — เลิกนับ weekly quota เอง เปลี่ยนไปอ่านจาก header `X-RateLimit-Limit/Remaining/Reset` ของ Elsevier หลังทุก request
- [x] `ScopusProxyService.js` — persist state ลงไฟล์ JSON บน disk (write-through) แทน RAM ล้วนๆ
- [x] `ScopusProxyService.js` — เลิกใช้ `setInterval`/`setTimeout` เปลี่ยนเป็น lazy-check ใน `getNextKey()`
- [x] `ScopusService.js` — แก้ call site ให้ await `getNextKey()`/`incrementUsage()`/`markKeyUnavailable()` (เปลี่ยนเป็น async)
- [x] คง logic เดิม: 429 จริงที่หลุดรอด (หลัง throttle) ยัง block 1 ชม. เหมือนเดิม

### A3. ตัดระบบที่ไม่อยู่ใน proposal scope
- [x] ลบ `BugReportModel.js`, `BugReportController.js`, `bugReportRoutes.js` ทั้งไฟล์
- [x] `routes/index.js` — ตัดจุด register `bugReportRoutes`
- [x] Migration: `DROP TABLE bug_reports` (แก้ที่ `db/init/001_schema.sql` โดยตรง — table ยังไม่เคย apply จริง)
- [x] ลบ `SystemLogModel.js` ทั้งไฟล์
- [x] `AdminController.js` — ตัด endpoint `GET /api/admin/logs` (`getLogs`)
- [x] `AuthService.js` — ตัดทุกจุดที่เรียก `SystemLogModel.log(...)`
- [x] Migration: `DROP TABLE system_logs` (แก้ที่ `db/init/001_schema.sql` โดยตรง)
- [x] Migration: `DROP TABLE email_notifications` (ไม่มีโค้ดอ้างถึงเลย — แก้ที่ `db/init/001_schema.sql` โดยตรง)

### A4. ตัด Login Lockout Tracking
- [x] Migration: ตัด column `users.failed_login_attempts`, `locked_until`, `last_login_at`, `last_login_ip` (แก้ที่ `db/init/001_schema.sql` โดยตรง)
- [x] `UserModel.js` — ลบ `isLocked()`, `incrementFailedAttempts()`
- [x] `AuthService.login()` — ตัดจุดเรียก `isLocked()`/`incrementFailedAttempts()`
- [x] (เพิ่มเติมนอกเหนือ checklist) `UserModel.resetFailedAttempts()` ก็ต้องลบด้วย เพราะเขียนทับ 4 column เดียวกันที่ตัดไปแล้ว — ลบพร้อม call site ใน `AuthService.js` ทั้ง login + googleLogin flow
- [x] ลบ `config.login` (maxAttempts/lockoutMinutes) ที่ตายจาก A4 นี้ + `LOGIN_MAX_ATTEMPTS`/`LOGIN_LOCKOUT_MINUTES` ใน `.env.example`
- [x] ลบ field `lastLoginAt`/`last_login_at` ที่เหลือค้างใน `AdminController.js` (2 จุด), `AuthController.js`, `UserController.js`

### A5. Soft-delete → Hard-delete
- [x] `users.deleted_at` — เปลี่ยนทุก `UPDATE ... SET deleted_at = NOW()` เป็น `DELETE FROM users`
- [x] ไล่ทุก `WHERE deleted_at IS NULL` ที่เกี่ยวกับ `users` ออก (เพราะแถวที่ลบจะหายไปเลย ไม่ต้อง filter)
- [x] `msu_unwanted_journals.deleted_at`/`deleted_by` — เปลี่ยนเป็น hard delete เหมือนกัน
- [x] ไล่ทุก `WHERE deleted_at IS NULL` ของ `msu_unwanted_journals` ออก
- [x] เช็ค FK cascade/orphan record ที่อาจเกิดจากการ hard-delete `users` (เช่น `pre_t3_requests.student_id`, `advisor_assignments.advisor_id` ที่อ้างถึง user ที่โดนลบ) — ผลเช็ค: schema เดิมตั้งไว้ปลอดภัยอยู่แล้ว `advisor_assignments`/`pre_t3_requests`/`t3_requests.student_id`/`msu_unwanted_journals.created_by` เป็น `ON DELETE RESTRICT` (กันลบ user ที่มีข้อมูลอ้างอิงอยู่), `otp_requests`/`auth_tokens` เป็น `CASCADE` (ถูกต้อง — ไม่มีความหมายถ้า user หาย), `request_approvals.approver_id`/`t3_requests.grad_school_relayed_by` เป็น `SET NULL` (ถูกต้อง) ไม่ต้องแก้ schema เพิ่ม

### A6. ตัด Column ปลีกย่อย
- [x] `advisor_assignments` — ตัด `assigned_at`
- [x] `t3_evidence_files` — ตัด `uploaded_at`
- [x] `request_approvals` — ตัด enum `'Program_Chair'` ออกจาก `step`, ตัด column `created_at`
- [x] `auth_tokens` — ตัด `ip_address`, `user_agent`, `created_at`
- [x] `otp_requests` — ตัด `ip_address`, `user_agent`
- [x] `users` — ตัด `faculty`, `oauth_provider_id`, `updated_at` — เช็คแล้วว่า `oauth_provider_id` เป็น write-only จริง (Admin/import ใส่แค่ `UUID()` สุ่ม ไม่เคยมี Google sub จริง, login ทุก flow match ด้วย `msu_mail` เท่านั้น) ตัดได้โดยไม่กระทบ auth เลย ต้องแก้ CHECK constraint `chk_login_method` ด้วย (เอาเงื่อนไข `oauth_provider_id IS NOT NULL` ออก)
- [x] `msu_unwanted_journals` — ตัด `updated_at`
- [x] `pre_t3_requests` — ตัด `degree_level`, `curriculum_year`, `study_plan_code` (join ผ่าน `users` แทน)
- [x] `t3_requests` — ตัด `issn`, `journal_name`, `degree_level`, `curriculum_year`, `study_plan_code` (join ผ่าน `pre_t3_requests`/`users` แทน)
- [x] `t3_requests` — ตัด `grad_school_status`, `grad_school_remark`, `grad_school_decided_at`, `grad_school_relayed_by`, `submission_date`, `submission_round_cutoff`
- [x] แก้ query ทุกจุดที่ยังอ้าง column ที่ถูกตัดออกไป (SELECT/INSERT/response builder) ให้ join แทน
- [x] `users.department` — ถามอาจารย์แล้ว **ตัดสินใจเก็บไว้** ไม่ต้องแก้โค้ดอะไรเพิ่ม (ดูรายละเอียดที่ A10)

### A7. ลบ Dead Code
- [x] `T3Model.js` — ลบ `gradSchoolReview()`, `updateSubmissionDetails()`, `_buildGradSchoolApproval()` + จุดใช้ใน response object (ทำระหว่าง A6 เพราะ column ที่ฟังก์ชันพวกนี้ใช้ถูกตัดไปแล้ว — ยืนยันแล้วว่าไม่มี route ไหนเรียกทั้งสองฟังก์ชันแรกเลยตั้งแต่ต้น)
- [x] `T3Model.js` — ลบ `getEvidenceFiles()` (ไม่มี caller ที่ไหนเรียกใช้เลย ยืนยันด้วย grep ทั้ง src/)
- [x] `PreT3Model.create()` — ตัด parameter `studentInfo`/`advisorInfo` ที่ไม่ใช้แล้ว + comment เดิมที่อธิบายว่า unused (ทำระหว่าง A6 พร้อมกับตัด `studentSnapshot` param ในฟังก์ชันเดียวกัน)
- [x] `T3Controller.js` header comment — ตัดการอ้างอิง endpoint `grad-school-review` ที่ไม่มีจริง (มาจาก TO_FIX #13)

### A8. DB Cleanup Job ใหม่ (กัน DB บวม)
- [x] `server.js` — เพิ่ม `setInterval` เรียก cleanup ทุก 24 ชม.
- [x] ต่อ `RefreshTokenModel.deleteExpired()` เข้า interval นี้
- [x] `OtpModel.js` — เขียนฟังก์ชันใหม่ `deleteExpired()` (ลบ `otp_requests` ที่ `expires_at < NOW()` และ `used_at IS NOT NULL` มานานแล้ว) — ตีความเป็น OR ไม่ใช่ AND (ลบทั้งแถวหมดอายุ-ไม่เคยใช้ และแถวที่ใช้ไปแล้วเกิน retention 7 วัน) เพราะ AND ล้วนจะไม่มีทางลบแถวที่หมดอายุแต่ไม่เคยถูกใช้เลย ขัดกับจุดประสงค์ "กัน DB บวม"
- [x] ต่อ `OtpModel.deleteExpired()` เข้า interval เดียวกัน

### A9. ยังไม่ปิดจบ / รอข้อมูลเพิ่ม
- [x] **ER Diagram** — นัดกับ อ.ปนิดาแล้ว เสร็จเรียบร้อย
- [x] **T3 ไม่มี resubmit endpoint** — ถามทีมแล้ว ได้คำตอบ 2 flow:
  1. T3 reject → ยื่น T3 ใหม่อ้าง `pre_t3_id` เดิม (ที่ Approved อยู่แล้ว) ได้เลย — **เช็คโค้ดแล้วพบว่าทำงานได้อยู่แล้วโดยไม่ต้องแก้อะไร**: `T3Controller.submit()` เช็คแค่ pre_t3 ต้อง Approved + เป็นของนิสิตคนนั้น ไม่เช็คว่าเคยมี T3 มาก่อนไหม และ schema ไม่มี UNIQUE(pre_t3_id) บน `t3_requests` เลยยื่นซ้ำผ่าน `POST /api/t3` เดิมได้ทันที ไม่ต้องมี resubmit endpoint แยก
  2. Pre-T3 ใช้งานต่อไม่ได้จริง (ตาม remark ตอน reject T3) → นิสิตลบ Pre-T3 ของตัวเองได้ แล้วเริ่ม flow ใหม่ (Pre-T3 ใหม่ → T3 ใหม่) — **แก้แล้ว**: `PreT3Model.cancel()`/`PreT3Controller.cancel()` เดิมอนุญาตยกเลิกแค่ `Pending`/`Rejected` เพิ่มให้ยกเลิก `Approved` ได้ด้วย แต่ **ห้ามยกเลิกถ้ามี T3 ที่ Approved ผูกอยู่แล้ว** (กัน record สำเร็จสมบูรณ์ถูกลบพลาด — ยืนยันกับคุณแล้วว่าต้องการแบบนี้) เช็คแบบ atomic ในเงื่อนไข UPDATE เดียวกัน กัน race condition + เพิ่ม `PreT3Model.hasApprovedT3()` ให้ controller เช็คก่อนเพื่อ error message ที่ชัดเจน (`T3_ALREADY_APPROVED`)
     - แถม: เจอบั๊กจาก Section B ("PreT3Controller.cancel() ไม่เช็ค return จาก Model.cancel()") พอดีตอนแก้จุดนี้ เลยแก้ให้ด้วยในตัว
     - ทดสอบจริงผ่าน Docker ครบ 3 เคส: resubmit T3 ซ้ำ pre_t3_id เดิม, ยกเลิก Approved ที่มี T3 approved ผูกอยู่ (ต้อง block), ยกเลิก Approved ที่ยังไม่มี T3 approved (ต้องผ่าน) — ผ่านหมด

### A10. ข้อที่ตัดสินใจแล้ว (รอลงมือแก้โค้ด)
- [x] **`users.department`** — ตัดสินใจ**เก็บไว้** (ยืนยันว่าใช้งานจริง มี description "ภาควิชา/สาขาที่สังกัด" + ตัวอย่าง "สาขาวิทยาการคอมพิวเตอร์" อยู่แล้วในเอกสาร) — อัปเดต comment ใน `db_script/journal_watch_schema_v3.sql` แล้ว ไม่ต้องแก้โค้ดอะไรเพิ่ม
- [x] **`Program_Chair` role** — ตัดสินใจ**ตัดออก** จากเอกสาร (ตารางที่ 3.4 `users.role` enum) และ `journal_watch_schema_v3.sql` (`users.role` enum ไม่มีอยู่แล้ว) เรียบร้อยแล้ว
  - [x] แก้แล้ว — ตัด `'Program_Chair'` ออกจาก `allowedRoles` ใน `AdminController.createUser()`/`importUsers()` และ `ALL_ROLES` ใน `routes/userRoutes.js`
- [x] **pre-T3/T3 auto-approve co-advisor** — ถามทีมแล้ว ได้ flow ที่ชัดเจนกว่าที่ร่างไว้เดิม (ของเดิมคิดว่าต้องแจ้ง co-advisor **ตอนยื่นคำร้อง**ให้ไปหารือ — จริงๆ ไม่ต้อง เปลี่ยนเป็นแจ้ง**หลังที่ปรึกษาหลักตัดสินใจแล้ว**แทน):
  - Flow จริง: ที่ปรึกษาหลัก + co1 + co2 คุยตกลงกันเองนอกระบบ แล้วให้ที่ปรึกษาหลักเป็นคนกดอนุมัติ/ปฏิเสธในระบบ (ระบบ auto-approve co-advisor ให้ทันที — logic เดิมถูกอยู่แล้วไม่ต้องแก้)
  - อีเมลใหม่ที่ต้องมี: หลังที่ปรึกษาหลักกดอนุมัติ/ปฏิเสธ → ส่งอีเมล**แจ้งเตือนเฉยๆ**ไปหา co1/co2 (ถ้ามี) ว่าที่ปรึกษาหลักตัดสินใจแล้ว ไม่ต้องทำอะไรต่อ — มีไว้เผื่อทั้ง 3 คนคุยตกลงกันเสร็จแล้วแต่ที่ปรึกษาหลักลืมกดในระบบ, co1/co2 จะได้สังเกตว่าไม่มีอีเมลแจ้งเข้ามา แล้วไปทวงถามที่ปรึกษาหลักได้
  - **แก้แล้ว**:
    - `MailService.js` — เพิ่ม event `major_advisor_approved`/`major_advisor_rejected` (แยกกันทั้ง Pre-T3 และ T3 content builder) เนื้อหาระบุชัดว่า "แจ้งเตือนเฉยๆ ไม่ต้องดำเนินการ"
    - `PreT3Controller.advisorReview()`/`T3Controller.advisorReview()` — เช็คว่าคนที่เพิ่งกดคือที่ปรึกษาหลัก (`mySlot === row.advisor_approval`) ถ้าใช่ ส่งอีเมลแจ้งเตือนให้ co1/co2 ทุกคนที่มีอยู่จริง (ดึง email ผ่าน `UserModel.findById` จาก `user_id` ใน approval slot)
  - ทดสอบจริงผ่าน Docker: จำลอง major advisor กดอนุมัติ Pre-T3 ที่มีทั้ง co1+co2 → ยืนยันว่านิสิตได้ `advisor_approved`, co1/co2 ได้ `major_advisor_approved` ถูกคนถูก event ครบ
- [x] **pre-T3 Checklist 9 ข้อ — ตัด Auto-check ออก ให้นิสิตติ๊กเองทั้งหมด** — **ปิดงานฝั่ง backend แล้ว ไม่ต่อแก้ในนี้** เป็นงานฝั่ง Frontend (Angular) ล้วนๆ ส่งต่อให้ทีม frontend ไปแก้เอง (จุดที่ต้องแก้: ฟังก์ชัน `auto(id, cond)` ในฟอร์ม Pre-T3 ที่ auto-tick ข้อ 1,3,4,5,6,7,8,9 → เปลี่ยนเป็น `ms(id)` manual ทั้งหมด, `ngOnInit()` ตัดส่วน pre-check checklist ออก, `canSubmit` เปลี่ยนที่มาของสถานะเป็น manual)

---

## Section B — Bug Fixes (ทำหลัง Section A เสร็จหมดแล้วเท่านั้น)

รวมจาก TO_FIX.md เดิม — ตัดข้อที่ moot ไปแล้วเพราะไฟล์/ฟีเจอร์ที่บั๊กอยู่ถูกลบทิ้งใน Section A ออก
(ข้อที่ตัดออกไป: BugReportController leak err.message, โค้ดซ้ำ cache 4 ไฟล์, `TCIScraper._formatCachedResult` ทิ้ง field, ScopusProxyService in-memory — ทั้งหมดนี้แก้ทางอ้อมจาก Section A แล้ว)

### 🔴 Critical — Security exploit ได้จริงตอนนี้
- [x] **Stored XSS ผ่านไฟล์อัปโหลดที่ปลอม MIME type** — แก้ครบทั้ง 3 ทาง:
  - ติดตั้ง `file-type@16.5.4` (เวอร์ชัน CJS-compatible ตัวสุดท้าย — v17+ เป็น ESM-only ซึ่งโปรเจกต์นี้ใช้ CommonJS ทั้งหมด) — มี moderate vuln เรื่อง ASF parser (Windows Media) แต่ไม่เกี่ยวกับ use case เรา (จำกัดแค่ PDF/JPG/PNG/WEBP)
  - `middlewares/upload.js` — เพิ่ม `MIME_TO_EXT` map + แก้ `filename()` ให้ยึดนามสกุลตาม MIME ที่ fileFilter อนุมัติเท่านั้น (ไม่ใช้ของ client อีกต่อไป) + export `verifyFileType()` เช็ค magic bytes จริง (รับได้ทั้ง path/Buffer)
  - `UploadController.uploadFiles()` — เช็ค magic bytes หลัง multer เขียนไฟล์เสร็จ ไม่ผ่านลบไฟล์ทิ้ง + คืน 400; `downloadFile()` เปลี่ยนจาก `res.sendFile()` เป็น `res.download()` (บังคับ attachment เสมอ)
  - `UnwantedJournalController` — แก้ `evidenceStorage.filename()` เหมือนกัน, เพิ่ม magic-byte check ใน `createOne`/`updateOne` ทั้งคู่, เปลี่ยน `getEvidenceFile()` เป็น `res.download()`
  - **เจอเพิ่มระหว่างแก้** (ไม่ได้อยู่ใน 3 จุดที่ระบุไว้แต่ช่องโหว่เดียวกัน): `T3Controller.submitWithFiles()` เขียนไฟล์เองแยกจาก `upload.js` (memory storage + `fs.writeFileSync` ตรงๆ) ก็แก้ extension + เพิ่ม magic-byte check ให้ด้วย
  - ทดสอบจริงผ่าน Docker: ไฟล์ HTML/SVG ที่มี `<script>` ฝังอยู่ปลอมเป็น PDF/PNG → `verifyFileType()` บล็อกถูกต้องทั้ง buffer-based (memory storage) และ path-based (disk storage), PDF จริงผ่านปกติ

### ⚠️ Pre-deploy checklist
- [x] `/api/v3/logs` เปิดสาธารณะไม่ต้อง login (`routes/logRoutes.js`) — เพิ่ม middleware guard `NODE_ENV === 'production' → 404`

### 🟠 บั๊กกระทบข้อมูล/สิทธิ์
- [x] `AuthService.js` — ย้าย `createdAt` จาก module-level เข้าไปใน `registerStaff` (ใช้ `new Date()` ตรง return แทน)
- [x] `AuthService.registerStaff` — เลิก bypass Model layer, เพิ่ม `UserModel.createPendingStaff()` แล้วเรียกผ่าน Model แทน raw `db.query`
- [x] `UserController.updateProfile` — ตัด `prefix`/`first_name`/`last_name` ออกจาก body/merge/UPDATE เหลือแค่ `phone`/`facebook_id`/`line_id`
- [x] `AdminController.suspendUser` — แก้ `req.user.userId` → `req.user.sub`
- [x] `PreT3Model.resubmit()` — เช็ค `affectedRows` ของ UPDATE แรก คืน `false` ถ้าไม่ตรงเงื่อนไข (ไม่รัน UPDATE ที่สองต่อ) + `PreT3Controller.resubmit()` เช็ค return แล้วตอบ 400 ถ้า `false`
- [x] `T3Controller.cancel()` — เช็ค return จาก `Model.cancel()` (คืน `affectedRows > 0` อยู่แล้ว) ตอบ 400 ถ้า `false`
- [x] `JournalController.proxyStatus` — เพิ่ม try/catch/next
- [x] `MailService` — เพิ่ม `_escapeHtml()` escape ก่อนแทรกเข้า `_buildPreT3Html()`/`_buildOtpHtml()` ทุกจุดที่รับ input จากภายนอก
- [x] `UnwantedJournalController.createOne` — ตัด ternary ไม่มีความหมายออก เหลือ `res.status(400)` ตรงๆ

### 🟢 Cleanup / Refactor (ไม่กระทบ behavior)
- [x] `T3Controller.submit()` กับ `submitWithFiles()` — extract `_validateAndCreate()` ใช้ร่วมกัน (validate + หา advisor + `T3Model.create()`) เหลือแค่ parse body / จัดการไฟล์ / ส่งอีเมล ที่ต่างกันจริง
- [x] `PreT3Model.js` กับ `T3Model.js` — extract `_approvalHelpers.js` (`slotFromApproval`, `fetchApprovalsMap`, `reviewAdvisorSlot`, `withTransaction`) ใช้ร่วมกัน
- [x] Documentation debt — แก้ comment `/api/admin/users/...` → `/api/manage/users/...` ทั้งหมดใน `AdminController.js`/`UserController.js` (`deleteAdmin` comment ถูกอยู่แล้ว ไม่ต้องแก้)
- [x] เพิ่ม database transaction: `AdminController.importUsers`/`updateAdvisors`, `UnwantedJournalController.importCsv` (wrap ด้วย `conn.beginTransaction`/`commit`/`rollback`), `PreT3Model`/`T3Model` `advisorReview`/`facultyReview`/`resubmit` (ใช้ `_approvalHelpers.withTransaction()` ร่วมกัน)
- [x] `errorResponse.js`/`errorHandler.js` — เพิ่ม `status` ต่อ error type ใน `MYSQL_ERRORS`/`JWT_ERRORS`/`FS_ERRORS`/Multer/default แล้วใช้ `parsed.status || 500` แทน hardcode 500
- [x] `errorResponse.js` — `serverError()` เพิ่ม special-case สำหรับ error ที่พก `statusCode`+`code` มาเอง (เช่น `AuthError`) ให้ behavior ตรงกับ `errorHandler.js`

### 🔵 ควรพิจารณา (ไม่ใช่บั๊ก แต่ควรตระหนัก)
- [x] `TCIService`/`TCIScraper` — เลิก fallback เป็น `journals[0]`/`apiResult[0]` แล้ว ไม่เจอ exact ISSN match ให้ถือว่าไม่พบวารสาร (คืน `null` → caller ตอบ 404 อยู่แล้ว) ดีกว่าเดาวารสารอื่นที่ผลค้นหาใกล้เคียง
- [x] `T3Controller.submitWithFiles` — เปลี่ยนเป็น `fs/promises` (ไม่บล็อก event loop) + แยกเป็น 2 loop: เช็ค magic bytes ของทุกไฟล์ก่อน แล้วค่อยเขียนไฟล์ทั้งหมด (fail ก่อนเขียนไฟล์ไหนเลย เลยไม่ต้อง rollback)
- [x] `T3Controller.normalizePublicationType` — ยัง default เป็น `National_TCI_Tier2` เหมือนเดิม (ตัดสินใจ business logic ไม่ใช่หน้าที่โค้ด) แต่เพิ่ม `console.warn` ตอน parse tier ไม่ได้ ให้เห็นชัดแทนที่จะเงียบ
- [x] `rateLimit.js` — เพิ่ม startup warning ถ้า `NODE_ENV` ถูกตั้งเป็นค่าที่ไม่ใช่ `production`/`development` (พิมพ์ผิด) กันหลุด dev-mode fallback แบบไม่รู้ตัว
- [x] Scraping endpoint (`/journal/*/scrape`) — เพิ่ม `scrapeLimiter` (10 ครั้ง/5 นาที/IP) ใน `rateLimit.js` + wire เข้า `journalRoutes.js`
- [x] `MailService` — เปลี่ยนจาก `transporter = null` เงียบๆ เป็น throw ตอน startup ถ้า `MAIL_MODE` ไม่ใช่ `console`/`smtp`
- [x] noVNC — bind port 5900/6080 เป็น `127.0.0.1:...` ใน `docker-compose.yml` แทน publish ออกทุก interface (ต้อง SSH tunnel ถ้าจะดูจากเครื่องอื่น)

---

## Section C — บั๊กที่เจอจากการไล่หารอบสุดท้าย (ยังไม่แก้ — รวบรวมไว้ก่อน)

ไล่หาบั๊กแบบ full read-through ทั้ง `src/controllers/`, `src/models/`, `src/services/`, `src/middlewares/` + `src/routes/` + `src/utils/` + `src/config/` (4 รอบแยกกัน) เจอทั้งหมด 20 ข้อ เรียงตามความรุนแรง — **ยังไม่ได้แก้ข้อไหนเลย** รอสั่งก่อนเริ่ม

### 🔴 Critical — Account takeover / Security exploit ได้จริง
- [x] `AdminController.updateUser` — เพิ่ม guard block `['Admin','SuperAdmin']` เหมือน `suspendUser` แล้ว (403 ถ้า target เป็น Admin/SuperAdmin)
- [x] `AdminController.activateUser` — เพิ่ม guard block `['Admin','SuperAdmin']` เหมือนกัน + select `role` เพิ่มใน query
- [x] `src/routes/logRoutes.js` — เพิ่ม `requireAuth, requireRole('Admin','SuperAdmin')` ทั้ง router ไม่พึ่ง `NODE_ENV` guard เพียงอย่างเดียวอีกต่อไป
- [x] `src/middlewares/upload.js` — `storage.destination` เช็ค `req.params.id` ด้วย `/^\d+$/` ก่อนต่อ path เสมอ ไม่ผ่านให้ `cb(new Error(...))` (เพิ่ม error-code handling ใน `uploadRoutes.js` ด้วย)
- [x] `src/services/AuthService.js` (googleLogin, registerStaff) — ตัดเงื่อนไข `domain !== 'gmail.com'` ออก เหลือเช็คแค่ `config.google.allowedDomain` ตรงกับ error message ที่บอกไว้

### 🟠 บั๊กกระทบข้อมูล/สิทธิ์
- [ ] `PreT3Model.create()` / `T3Model.create()` — INSERT หลัก + insert `request_approvals` แต่ละแถว เป็นคนละ `db.query()` แยกกัน ไม่ได้ wrap ด้วย `withTransaction()` เหมือนฟังก์ชันอื่นในไฟล์เดียวกัน → ถ้า insert approval row กลางทางพัง (เช่น advisor id หลุด) จะเหลือ request ที่ไม่มีแถว approval เลย มองไม่เห็นจากทุกฝั่ง reviewer ถาวร
- [ ] `PreT3Model.cancel()` / `T3Model.cancel()` — เปลี่ยนแค่ `overall_status` ไม่ cascade ไปที่แถว `request_approvals` ที่ยัง `Pending`; ส่วน `advisorReview()`/`facultyReview()` ก็ไม่เช็ค `overall_status` ก่อนเขียนทับ → ถ้านิสิตกด cancel ขณะ advisor/staff มีแท็บ pending ค้างอยู่ แล้วกด approve/reject ทีหลัง จะเขียนทับ `Cancelled` กลับเป็น `Rejected`/`Approved` ได้เงียบๆ (เกิดกับทั้ง Pre-T3 และ T3)
- [ ] `AdminController.createUser` (single-user, บรรทัด ~318) — insert `users` + insert `advisor_assignments` เป็นคนละ query แยกกัน ไม่ transaction เหมือน `importUsers` (ที่แก้เป็น all-or-nothing ไปแล้วใน Section B) → advisor insert พังกลางทางจะเหลือ user ที่สร้างไปแล้วแต่ไม่มี advisor และ retry ซ้ำจะเจอ "MSU Mail มีอยู่ในระบบแล้ว"
- [ ] `AdminController.importUsers` (CSV, บรรทัด ~554-574) — insert advisor `Co_1` ถูก nest อยู่ใน `if (row.advisor_major_mail)` ทั้งที่ validate แยกอิสระ → row ที่มี `advisor_co1_mail` แต่ไม่มี `advisor_major_mail` จะผ่าน validation แต่ไม่ได้ insert advisor assignment ใดๆ เลย เงียบๆ
- [ ] `UnwantedJournalController.updateOne` — ไม่เช็ค ISSN ซ้ำตอนแก้ `issn` ทั้งที่ `createOne`/`importCsv` เช็ค (schema เป็นแค่ INDEX ไม่ใช่ UNIQUE เลย DB ก็ไม่กันให้) → แก้ ISSN ให้ซ้ำกับ record อื่นได้ ทำให้ `checkByIssn` (LIMIT 1) ไม่ชัดเจนว่าอ้างถึง record ไหน
- [ ] `UnwantedJournalController.updateOne` — ลบไฟล์ evidence เก่าออกจาก disk (`fs.unlinkSync`) **ก่อน** UPDATE DB สำเร็จ ถ้า UPDATE query พังทีหลัง จะเหลือ DB row ชี้ไปที่ไฟล์ที่ไม่มีอยู่จริงแล้ว (catch block ลบแค่ไฟล์ใหม่ที่เพิ่งอัปโหลด ไม่ได้กู้ไฟล์เก่าคืน)

### 🟡 ความน่าเชื่อถือของ Scopus integration
- [ ] `ScopusProxyService._persist()` — เชื่อม promise chain ต่อกันด้วย `this._writeQueue = this._writeQueue.then(() => this._writeAtomic(...))` ไม่มี `.catch` เลย → ถ้า `_writeAtomic` fail แม้แค่ครั้งเดียว (เช่น `fs.rename` ชน EPERM/EBUSY ชั่วคราว) queue จะค้าง rejected ตลอดไป ทุก call ถัดไปที่ `await this._persist()` (เช่นใน `incrementUsage()`) จะ throw ตลอด ทำให้ Scopus integration ทั้งระบบพังจนกว่าจะ restart process
- [ ] `ScopusProxyService` per-second throttle — `_isThrottled()` เช็คจาก `recentRequestTimestamps` แต่ timestamp ถูกบันทึกใน `incrementUsage()` ซึ่งเรียก**หลัง** `axios.get` resolve แล้ว (ไม่ใช่ตอนเริ่มยิง) → ยิง request พร้อมกันหลายตัว (เช่น `Promise.all` sync วารสารหลายรายการ) จะผ่าน throttle check พร้อมกันหมดก่อนที่ตัวไหนจะ resolve เลย เกิด burst เกิน `PER_SECOND_LIMIT` จริงตามที่ระบบตั้งใจจะกัน
- [ ] `ScopusService` — เจอ 429 ล็อค key เป็นเวลาคงที่ 1 ชม. เสมอ ไม่แยกว่าเป็น burst throttle ปกติหรือ weekly quota หมดจริง (ไม่อ่าน `err.response.headers` ตอน error เลย) → key ที่ quota หมดทั้งสัปดาห์จะถูกปลดล็อคหลัง 1 ชม. แล้วโดน 429 ซ้ำวนไปเรื่อยๆ แทนที่จะพักยาวจนถึง reset จริง

### 🟢 ควรพิจารณา (severity ต่ำ)
- [ ] `AuthService._issueOtpForUser()` / `requestPasswordReset()` — เรียก `MailService.sendOtp()` แบบไม่ await ไม่เช็ค `{success,error}` ที่ return กลับมา → ถ้า SMTP พัง client จะได้ response ว่า "ส่ง OTP แล้ว" ทั้งที่ไม่มีอีเมลไปถึงจริง
- [ ] `_approvalHelpers.reviewAdvisorSlot()` / `PreT3Model.facultyReview()` / `T3Model.facultyReview()` — เช็ค action ด้วย `action === 'approve' ? 'Approved' : 'Rejected'` ไม่ validate ค่า `action` เลย → ค่าที่ไม่คาดคิด (`undefined`/พิมพ์ผิด) จะถูกตีความเป็น "ปฏิเสธ" เงียบๆ แทนที่จะ error
- [ ] `src/middlewares/rateLimit.js` — `skipLocalhost` เช็ค `ip.startsWith('172.')` ซึ่งครอบคลุม `172.0.0.0/8` ทั้งช่วง ทั้งที่ Docker bridge จริงคือ `172.16.0.0/12` เท่านั้น → ตอน dev mode ผู้ใช้จริงที่ IP สาธารณะขึ้นต้นด้วย 172 (มีเยอะ เช่น Cloudflare, Google) จะโดน skip rate limit ไปด้วย
- [ ] `src/middlewares/rateLimit.js` + `app.js` (`trust proxy: 1`) — `skipLocalhost` เชื่อ `req.ip` ซึ่งมาจาก header `X-Forwarded-For` ที่ client กำหนดเองได้ ถ้า server ไม่ได้อยู่หลัง reverse proxy จริง (ปกติตอน dev/staging) → ส่ง header ปลอมเป็น `127.0.0.1` ได้ บายพาส rate limit ทุกตัวจากเครื่องไหนก็ได้
- [ ] `src/routes/authRoutes.js` — `POST /auth/refresh` ไม่มี rate limiter เลย ทั้งที่ endpoint auth อื่นๆ ทุกตัวมี (`login`/`verify-otp`/`resend-otp`/`reset-password`/`google`/`register-staff`/`forgot-password`)
- [ ] `ScopusProxyService` weekly-quota lazy reset (บรรทัด ~63-71) — reset `weeklyRemaining` ใน memory ตรงๆ ไม่เรียก `_persist()` ทันที (self-heal ได้เองรอบถัดไป แต่ไม่ตรงกับ "write-through" ที่ comment หัวไฟล์บอกไว้ severity ต่ำสุดในกลุ่มนี้)

---

## หมายเหตุ
- `scopus_h_index: null` ใน `ScopusService.js`/`ScopusScraper.js` **ไม่ใช่บั๊ก** — ยืนยันแล้วว่า Scopus ไม่มีข้อมูลนี้ให้จริง ตั้งใจ hardcode ไว้
- ไฟล์นี้แทนที่ `TO_FIX.md` เดิม (ลบไปแล้ว) — รวมทุกอย่างไว้ที่นี่ที่เดียว
