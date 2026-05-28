/**
 * Auth Validators
 * ใช้ express-validator สำหรับ validate + sanitize input
 */
const { body } = require('express-validator');

const loginValidator = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 4, max: 50 }).withMessage('Username must be 4-50 characters')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username contains invalid characters')
    .toLowerCase(),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 1, max: 128 }).withMessage('Invalid password length'),
];

const verifyOtpValidator = [
  body('otpCode')
    .trim()
    .notEmpty().withMessage('OTP code is required')
    .isNumeric().withMessage('OTP must be numeric')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
];

const googleLoginValidator = [
  body('idToken')
    .trim()
    .notEmpty().withMessage('Google ID token is required')
    .isString().withMessage('Invalid token format'),
];

module.exports = {
  loginValidator,
  verifyOtpValidator,
  googleLoginValidator,
};