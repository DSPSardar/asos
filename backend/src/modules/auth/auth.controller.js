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
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

module.exports = { register, login, refresh, logout, me, googleAuth };
