/**
 * Upload Middleware
 * ใช้ multer เก็บไฟล์ลง Local disk
 * path: uploads/t3/{t3_id}/{field_name}/{timestamp}_{originalname}
 */
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ประเภทไฟล์ที่อนุญาต
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Field names ที่ใช้ใน T3
const T3_FIELDS = [
  'acceptance_letter',
  'full_paper',
  'journal_cover',
  'table_of_contents',
  'database_evidence',
  'peer_review_result',
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const t3Id = req.params.id || 'unknown';
    const dir  = path.join(process.cwd(), 'uploads', 't3', String(t3Id), file.fieldname);

    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext      = path.extname(file.originalname).toLowerCase();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${Date.now()}_${safeName}`;
    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`ประเภทไฟล์ไม่ถูกต้อง รองรับเฉพาะ PDF, JPG, PNG, WEBP เท่านั้น`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

// สำหรับ upload หลายไฟล์พร้อมกัน (แต่ละ field 1 ไฟล์)
const uploadT3Fields = upload.fields(
  T3_FIELDS.map(name => ({ name, maxCount: 1 }))
);

// Memory storage — ใช้กับ endpoint ที่ยังไม่มี t3_id (submit + upload พร้อมกัน)
const uploadT3FieldsMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
}).fields(T3_FIELDS.map(name => ({ name, maxCount: 1 })));

module.exports = { upload, uploadT3Fields, uploadT3FieldsMemory, T3_FIELDS };