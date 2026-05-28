/**
 * Auth Service
 * รวม business logic ของการ authentication:
 *   - login        : verify username/password + ออก OTP token
 *   - verifyOtp    : ตรวจ OTP + ออก access + refresh token
 *   - googleLogin  : verify Google ID token + ออก access + refresh token
 *   - refreshToken : ใช้ refresh token ออก access token ใหม่
 *   - logout       : revoke refresh token
 */
const bcrypt = require('bcryptjs');
const UserModel = require('../models/UserModel');
const OtpModel = require('../models/OtpModel');
const RefreshTokenModel = require('../models/RefreshTokenModel');
const SystemLogModel = require('../models/SystemLogModel');
const MailService = require('./MailService');
const cryptoUtil = require('../utils/crypto');
const jwtUtil = require('../utils/jwt');
const config = require('../config');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(config.google.clientId);
const createdAt = new Date();
class AuthError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode; 
  }
}

class AuthService {
  /**
   * Step 1: ตรวจ username + password → ออก OTP token + ส่ง OTP
   */
  static async login({ username, password, ipAddress, userAgent }) {
    const user = await UserModel.findByUsername(username);

    if (!user) {
      throw new AuthError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'INVALID_CREDENTIALS', 401);
    }

    if (!['Admin', 'SuperAdmin'].includes(user.role)) {
      throw new AuthError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'INVALID_CREDENTIALS', 401);
    }

    if (user.account_status === 'Suspended') {
      throw new AuthError('บัญชีนี้ถูกระงับการใช้งาน', 'ACCOUNT_SUSPENDED', 403);
    }
    if (user.account_status === 'Pending') {
      throw new AuthError('บัญชีของคุณรอการอนุมัติจากผู้ดูแลระบบ', 'ACCOUNT_PENDING', 403);
    }

    if (UserModel.isLocked(user)) {
      const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      throw new AuthError(
        `บัญชีถูกล็อคชั่วคราว กรุณารออีก ${minutesLeft} นาทีแล้วลองใหม่`,
        'ACCOUNT_LOCKED',
        423
      );
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      await UserModel.incrementFailedAttempts(
        user.user_id,
        config.login.maxAttempts,
        config.login.lockoutMinutes
      );
      await SystemLogModel.log({
        userId: user.user_id,
        action: 'login_failed',
        targetType: 'user',
        targetId: String(user.user_id),
        detail: { reason: 'wrong_password' },
        ipAddress,
        userAgent,
      });
      throw new AuthError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'INVALID_CREDENTIALS', 401);
    }

    await this._issueOtpForUser(user, ipAddress, userAgent);

    await SystemLogModel.log({
      userId: user.user_id,
      action: 'login_password_verified',
      targetType: 'user',
      targetId: String(user.user_id),
      ipAddress,
      userAgent,
    });

    const otpToken = jwtUtil.issueOtpToken(user.user_id);

    return {
      otpToken,
      maskedEmail: this._maskEmail(user.msu_mail),
      expiresIn: config.otp.expiresMinutes * 60,
    };
  }

  /**
   * Step 2: ตรวจ OTP + ออก access token + refresh token
   */
  static async verifyOtp({ userId, otpCode, ipAddress, userAgent }) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new AuthError('ไม่พบบัญชีผู้ใช้ในระบบ', 'USER_NOT_FOUND', 404);
    }

    const activeOtp = await OtpModel.findActive(userId, 'login_2fa');
    if (!activeOtp) {
      throw new AuthError('OTP หมดอายุหรือไม่พบในระบบ กรุณาเข้าสู่ระบบใหม่', 'OTP_EXPIRED', 400);
    }

    if (activeOtp.attempt_count >= config.otp.maxAttempts) {
      await OtpModel.markAsUsed(activeOtp.otp_id);
      throw new AuthError('ป้อน OTP เกินจำนวนครั้ง กรุณาเข้าสู่ระบบใหม่', 'OTP_MAX_ATTEMPTS', 429);
    }

    const isValid = cryptoUtil.compareOtpHash(otpCode, activeOtp.otp_hash);

    if (!isValid) {
      await OtpModel.incrementAttempts(activeOtp.otp_id);
      await SystemLogModel.log({
        userId,
        action: 'otp_failed',
        targetType: 'otp',
        targetId: String(activeOtp.otp_id),
        ipAddress,
        userAgent,
      });
      const attemptsLeft = config.otp.maxAttempts - (activeOtp.attempt_count + 1);
      throw new AuthError(`OTP ไม่ถูกต้อง เหลืออีก ${attemptsLeft} ครั้ง`, 'OTP_INVALID', 400);
    }

    await OtpModel.markAsUsed(activeOtp.otp_id);
    await UserModel.resetFailedAttempts(userId, ipAddress);

    await SystemLogModel.log({
      userId,
      action: 'login_success',
      targetType: 'user',
      targetId: String(userId),
      ipAddress,
      userAgent,
    });

    const accessToken = jwtUtil.issueAccessToken(user);
    const { token: refreshToken, hash, expiresAt } = jwtUtil.issueRefreshToken();

    await RefreshTokenModel.create({
      userId: user.user_id,
      tokenHash: hash,
      expiresAt,
      ipAddress,
      userAgent,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        userId: user.user_id,
        username: user.username,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
      },
    };
  }

  /**
   * ส่ง OTP ใหม่
   */
  static async resendOtp({ userId, ipAddress, userAgent }) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new AuthError('ไม่พบบัญชีผู้ใช้ในระบบ', 'USER_NOT_FOUND', 404);
    }
    await this._issueOtpForUser(user, ipAddress, userAgent);
    return {
      maskedEmail: this._maskEmail(user.msu_mail),
      expiresIn: config.otp.expiresMinutes * 60,
    };
  }

  /**
   * Google OAuth Login → ออก access token + refresh token
   */
  static async googleLogin({ idToken, ipAddress, userAgent }) {
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.google.clientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      throw new AuthError('Google Token ไม่ถูกต้อง', 'INVALID_GOOGLE_TOKEN', 401);
    }

    const email = payload.email;
    const emailVerified = payload.email_verified;

    if (!emailVerified) {
      throw new AuthError('อีเมล Google ยังไม่ได้รับการยืนยัน', 'EMAIL_NOT_VERIFIED', 401);
    }

    const domain = email.split('@')[1];
    if (domain !== config.google.allowedDomain && domain !== 'gmail.com') {
      throw new AuthError(
        `อนุญาตเฉพาะอีเมล @${config.google.allowedDomain} เท่านั้น`,
        'INVALID_DOMAIN',
        403
      );
    }

    const user = await UserModel.findByMsuMail(email);
    if (!user) {
      throw new AuthError(
        'ไม่พบบัญชีผู้ใช้ในระบบ กรุณาติดต่อเจ้าหน้าที่',
        'USER_NOT_FOUND',
        404
      );
    }

    if (user.account_status === 'Suspended') {
      throw new AuthError('บัญชีนี้ถูกระงับการใช้งาน', 'ACCOUNT_SUSPENDED', 403);
    }
    if (user.account_status === 'Pending') {
      throw new AuthError(
        'บัญชีของคุณรอการอนุมัติจากผู้ดูแลระบบ',
        'ACCOUNT_PENDING',
        403
      );
    }

    if (['Admin', 'SuperAdmin'].includes(user.role)) {
      throw new AuthError(
        'บัญชี Admin ต้องเข้าสู่ระบบผ่านหน้า Admin Login',
        'USE_ADMIN_LOGIN',
        403
      );
    }

    await UserModel.resetFailedAttempts(user.user_id, ipAddress);

    await SystemLogModel.log({
      userId: user.user_id,
      action: 'google_login_success',
      targetType: 'user',
      targetId: String(user.user_id),
      detail: { email },
      ipAddress,
      userAgent,
    });

    const accessToken = jwtUtil.issueAccessToken(user);
    const { token: refreshToken, hash, expiresAt } = jwtUtil.issueRefreshToken();

    await RefreshTokenModel.create({
      userId: user.user_id,
      tokenHash: hash,
      expiresAt,
      ipAddress,
      userAgent,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        userId: user.user_id,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        msuMail: user.msu_mail,
        degreeLevel: user.degree_level || null,
      },
    };
  }

  /**
   * Refresh — ใช้ refresh token ออก access token ใหม่
   * เรียกเมื่อ access token หมดอายุ (401)
   */
  static async refreshToken({ refreshToken, ipAddress, userAgent }) {
    if (!refreshToken) {
      throw new AuthError('ไม่พบ Refresh Token กรุณาเข้าสู่ระบบใหม่', 'NO_REFRESH_TOKEN', 401);
    }

    const tokenHash = jwtUtil.hashRefreshToken(refreshToken);
    const stored = await RefreshTokenModel.findByHash(tokenHash);

    if (!stored) {
      throw new AuthError('Refresh Token ไม่ถูกต้องหรือหมดอายุ', 'INVALID_REFRESH_TOKEN', 401);
    }

    const user = await UserModel.findById(stored.user_id);
    if (!user || user.account_status !== 'Active') {
      await RefreshTokenModel.revokeByHash(tokenHash);
      throw new AuthError('บัญชีนี้ไม่สามารถใช้งานได้ในขณะนี้', 'ACCOUNT_UNAVAILABLE', 401);
    }

    // Rotate: revoke token เก่า ออก token ใหม่
    await RefreshTokenModel.revokeByHash(tokenHash);

    const newAccessToken = jwtUtil.issueAccessToken(user);
    const { token: newRefreshToken, hash: newHash, expiresAt } = jwtUtil.issueRefreshToken();

    await RefreshTokenModel.create({
      userId: user.user_id,
      tokenHash: newHash,
      expiresAt,
      ipAddress,
      userAgent,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Logout — revoke refresh token
   */
  static async logout({ refreshToken }) {
    if (!refreshToken) return;
    const tokenHash = jwtUtil.hashRefreshToken(refreshToken);
    await RefreshTokenModel.revokeByHash(tokenHash);
  }

  // ===== Private helpers =====

  static async _issueOtpForUser(user, ipAddress, userAgent) {
    await OtpModel.invalidateActive(user.user_id, 'login_2fa');

    const otpCode = cryptoUtil.generateOtp();
    const otpHash = cryptoUtil.hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + config.otp.expiresMinutes * 60 * 1000);

    await OtpModel.create({
      userId: user.user_id,
      otpHash,
      purpose: 'login_2fa',
      expiresAt,
      ipAddress,
      userAgent,
    });

    await MailService.sendOtp(user.msu_mail, otpCode, 'login_2fa');
  }

  static _maskEmail(email) {
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    const visible = local.slice(0, 2);
    const masked = '*'.repeat(Math.max(local.length - 2, 1));
    return `${visible}${masked}@${domain}`;
  }

  /**
   * POST /api/auth/register-staff
   * Staff สมัครด้วย Google OAuth — เช็ค email pattern ก่อน
   */
  static async registerStaff({ idToken, ipAddress, userAgent }) {
    // Verify Google token
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.google.clientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      throw new AuthError('Google Token ไม่ถูกต้อง', 'INVALID_GOOGLE_TOKEN', 401);
    }

    const email = payload.email;
    if (!payload.email_verified) {
      throw new AuthError('อีเมล Google ยังไม่ได้รับการยืนยัน', 'EMAIL_NOT_VERIFIED', 401);
    }

    // เช็ค domain
    const domain = email.split('@')[1];
    if (domain !== config.google.allowedDomain && domain !== 'gmail.com') {
      throw new AuthError(
        `เฉพาะ @${config.google.allowedDomain} เท่านั้น`,
        'INVALID_DOMAIN',
        403
      );
    }

    // เช็ค pattern — ถ้าเป็นตัวเลขล้วนก่อน @ = นิสิต ห้ามสมัครเป็น Staff
    const localPart = email.split('@')[0];
    if (/^\d+$/.test(localPart)) {
      throw new AuthError(
        'อีเมลนิสิตไม่สามารถสมัครเป็นเจ้าหน้าที่ได้ กรุณาเข้าสู่ระบบด้วยปุ่ม "เข้าสู่ระบบ" แทน',
        'STUDENT_EMAIL_NOT_ALLOWED',
        403
      );
    }

    // เช็คว่ามี account อยู่แล้วไหม
    const existing = await UserModel.findByMsuMail(email);
    if (existing) {
      if (existing.account_status === 'Pending') {
        throw new AuthError(
          'บัญชีของคุณอยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบ',
          'ACCOUNT_PENDING',
          403
        );
      }
      if (existing.account_status === 'Active') {
        throw new AuthError(
          'อีเมลนี้มีบัญชีในระบบแล้ว กรุณาเข้าสู่ระบบด้วยปุ่ม "เข้าสู่ระบบ" แทน',
          'EMAIL_ALREADY_EXISTS',
          409
        );
      }
      if (existing.account_status === 'Suspended') {
        throw new AuthError('บัญชีนี้ถูกระงับการใช้งาน', 'ACCOUNT_SUSPENDED', 403);
      }
    }

    // สร้าง account ใหม่ role=Staff, status=Pending
    const db = require('../config/database');
    await db.query(
      `INSERT INTO journal_watch.users
         (msu_mail, oauth_provider, oauth_provider_id,
          role, first_name, last_name, account_status)
       VALUES (?, 'google', ?, 'Staff', ?, ?, 'Pending')`,
      [
        email,
        payload.sub,
        payload.given_name || localPart,
        payload.family_name || '',
      ]
    );

await SystemLogModel.log({
  userId: null,
  action: 'staff_register',
  targetType: 'user',
  targetId: email,
  detail: { email },
  ipAddress,
  userAgent,
});

return {
  email,
  firstName: payload.given_name || localPart,
  lastName: payload.family_name || '',
  role: 'Staff',
  createdAt: createdAt.toISOString(),
};
  }
}

module.exports = { AuthService, AuthError };