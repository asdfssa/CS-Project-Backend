# Journal Watch — Backend API

Backend ของระบบ Journal Watch สำหรับตรวจสอบสถานะวารสารจากฐานข้อมูล Scopus และ TCI
พัฒนาด้วย Node.js + Express ในรูปแบบ MVC

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express 4
- **Database**: MySQL 8 / MariaDB 10.11
- **Authentication**: JWT (2-step: password → OTP)
- **Password**: bcrypt cost 12
- **OTP**: SHA-256 hash, 6-digit numeric, 10 min expiry
- **Email**: Nodemailer (รองรับ console/SMTP mode)

## Project Structure

```
journal-watch-backend/
├── public/                    # Static UI สำหรับทดสอบ
│   └── index.html
├── src/
│   ├── config/                # Config + DB connection
│   ├── controllers/           # HTTP handlers (รับ req → ส่ง res)
│   ├── middlewares/           # auth, validation, rate limit, error
│   ├── models/                # Data access layer (queries)
│   ├── routes/                # Route definitions
│   ├── services/              # Business logic
│   ├── utils/                 # Helpers (logger, jwt, crypto)
│   ├── validators/            # Input validation rules
│   ├── app.js                 # Express app setup
│   └── server.js              # Entry point
├── tests/                     # Tests
├── .env.example               # Template ของ environment vars
└── package.json
```

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Setup database
```bash
# รัน schema (DB_Fix_v4.sql)
mysql -uroot < DB_Fix_v4.sql

# Insert SuperAdmin
mysql -uroot < insert_superadmin.sql
```

### 3. Configure environment
```bash
cp .env.example .env
# แก้ค่าใน .env ให้ตรงกับ DB ของคุณ
```

### 4. Run
```bash
# Development (auto reload)
npm run dev

# Production
npm start
```

เปิดเบราว์เซอร์ที่ <http://localhost:3000> เพื่อทดสอบ

## API Endpoints

### Authentication

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/login` | Step 1: ส่ง username + password → รับ OTP token | - |
| POST | `/api/auth/verify-otp` | Step 2: ส่ง OTP code → รับ access token | OTP token |
| POST | `/api/auth/resend-otp` | ส่ง OTP ใหม่ | OTP token |
| GET | `/api/auth/me` | ข้อมูล user ปัจจุบัน | Access token |
| POST | `/api/auth/logout` | Logout | Access token |
| GET | `/api/health` | Health check | - |

## Login Flow

```
┌──────────────┐
│   Step 1     │
│  Username +  │
│  Password    │
└──────┬───────┘
       │ POST /api/auth/login
       ▼
┌──────────────┐
│  Server      │
│  - bcrypt    │
│    verify    │
│  - send OTP  │ ───→ Email (10 min)
│  - issue     │
│    OTP token │
└──────┬───────┘
       │ { otpToken, maskedEmail }
       ▼
┌──────────────┐
│   Step 2     │
│   Enter OTP  │
└──────┬───────┘
       │ POST /api/auth/verify-otp
       │ Header: Bearer <otpToken>
       │ Body:   { otpCode }
       ▼
┌──────────────┐
│  Server      │
│  - SHA-256   │
│    compare   │
│  - issue     │
│    access    │
│    token     │
└──────┬───────┘
       │ { accessToken, user }
       ▼
   Logged In ✓
```

## Security Features

- **Password**: bcrypt cost 12 (OWASP recommended ≥ 10)
- **OTP**: SHA-256 hashed at rest (DB leak ก็ใช้ไม่ได้)
- **Account Lockout**: 5 failed → lock 15 min
- **OTP Lockout**: 5 wrong attempts → invalidate
- **Rate Limit**: 5 login/15 min per IP, 10 OTP/10 min per IP
- **JWT**: 2 separate tokens (OTP token 10 min vs Access token 2 hours)
- **Generic error messages**: ป้องกัน username enumeration
- **Constant-time compare**: ป้องกัน timing attack
- **Helmet**: security headers
- **CORS**: configurable origin

## Development Notes

- ตอน dev `MAIL_MODE=console` → OTP จะแสดงใน console ของ server
- ตอน production เปลี่ยนเป็น `MAIL_MODE=smtp` พร้อมตั้งค่า SMTP credentials
- เปลี่ยน `JWT_SECRET` เป็น random string ที่ยาว ≥ 64 chars

## License

MIT
