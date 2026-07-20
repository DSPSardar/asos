// src/modules/auth/auth.controller.js

const authService = require('./auth.service');
const { success, created, error } = require('../../utils/response');
const { z } = require('zod');

const registerSchema = z.object({
  tenantName: z.string().min(2).max(100),
  tenantSlug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2).max(100),
  // Optional — if provided, creates an organic lead immediately
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164 format').optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid reset token'),
  password: z.string().min(8).max(128),
});

const register = async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const result = await authService.register(body);
    return created(res, result, 'Tenant registered successfully');
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body);
    return success(res, result, 'Login successful');
  } catch (err) {
    next(err);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    await authService.requestPasswordReset(email);
    return success(res, {}, 'If an account exists for that email, a reset link has been sent.');
  } catch (err) {
    next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const body = resetPasswordSchema.parse(req.body);
    const result = await authService.resetPassword(body);
    return success(res, result, 'Password reset successfully');
  } catch (err) {
    next(err);
  }
};

const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);
    return success(res, result, 'Token refreshed');
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    await authService.logout(req.user.id);
    return success(res, {}, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
};

const me = async (req, res) => {
  return success(res, {
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    role: req.user.role,
    tenant: req.tenant,
  });
};

const googleAuth = async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) return next(Object.assign(new Error('Google credential required'), { statusCode: 400, expose: true }));
    const result = await authService.googleAuth(credential);
    return success(res, result, 'Google login successful');
  } catch (err) {
    next(err);
  }
};

const savePhone = async (req, res, next) => {
  try {
    const phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164 format (+923001234567)').parse(req.body?.phone ?? '');
    const result = await authService.saveOrganicPhone({ userId: req.user.id, tenantId: req.tenantId, phone });
    return success(res, result, 'Phone saved and lead created');
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword) {
      return res.status(400).json({ success: false, message: 'newPassword is required' });
    }
    const result = await authService.changePassword(req.user.id, { newPassword });
    return success(res, result, 'Password changed successfully');
  } catch (err) { next(err); }
};

const changeEmail = async (req, res, next) => {
  try {
    const { newEmail, currentPassword } = req.body || {};
    const result = await authService.changeEmail(req.user.id, { newEmail, currentPassword });
    return success(res, result, 'Email updated successfully');
  } catch (err) { next(err); }
};

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  me,
  googleAuth,
  savePhone,
  changePassword,
  changeEmail,
};
