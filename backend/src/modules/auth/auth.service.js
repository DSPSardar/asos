// src/modules/auth/auth.service.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../../config/database');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const { isPasswordResetEmailConfigured, sendPasswordResetEmail } = require('../../services/email.service');

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

// ── Token generators ──────────────────────────────────

const generateAccessToken = (userId, tenantId, role) => {
  return jwt.sign({ userId, tenantId, role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
};

const generateRefreshToken = (userId) => {
  const token = crypto.randomBytes(64).toString('hex');
  const hash  = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
};

// ── Organic lead creation helper ─────────────────────
// Called inside a Prisma transaction (tx) to create a Contact + Lead
// for the new admin user. Tags them as 'organic' so they appear in
// the CRM with a clear acquisition source.

const createOrganicLead = async (tx, { tenantId, name, email, phone }) => {
  // Upsert contact — if phone already exists for this tenant, reuse it
  let contact;
  try {
    contact = await tx.contact.upsert({
      where:  { tenantId_phone: { tenantId, phone } },
      create: { tenantId, phone, name, email, tags: ['organic'], optIn: true },
      update: { tags: { set: ['organic'] } },
    });
  } catch {
    // If upsert fails for any reason (e.g., race), skip lead creation silently
    return null;
  }

  // Only create a NEW lead if none exists for this contact yet
  const existing = await tx.lead.findFirst({ where: { contactId: contact.id, tenantId } });
  if (existing) return existing;

  return tx.lead.create({
    data: {
      tenantId,
      contactId: contact.id,
      stage:     'NEW',
      sourceUtm: { source: 'organic_signup' },
    },
  });
};

// ── Register new tenant + admin user ─────────────────

const register = async ({ tenantName, tenantSlug, email, password, fullName, phone }) => {
  // Check email not taken
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw Object.assign(new Error('Email already registered'), { statusCode: 409, expose: true });

  // Check slug not taken
  const slugTaken = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (slugTaken) throw Object.assign(new Error('Tenant slug already taken'), { statusCode: 409, expose: true });

  const passwordHash = await bcrypt.hash(password, 12);

  // Create tenant + user + default AI config + subscription in one transaction
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug: tenantSlug,
        name: tenantName,
        plan: 'FREE',
        status: 'PENDING_APPROVAL',   // account awaits superadmin approval before login is permitted
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email,
        passwordHash,
        role: 'TENANT_ADMIN',
        fullName,
      },
    });

    // Default AI config
    await tx.aiConfig.create({
      data: {
        tenantId: tenant.id,
        systemPrompt: `Você é um assistente de vendas profissional da empresa ${tenantName}. 
Sua função é qualificar leads, diagnosticar problemas e apresentar soluções de forma consultiva.
Seja empático, objetivo e sempre guie o prospect para a próxima etapa do processo de vendas.
Responda SEMPRE em português brasileiro de forma natural e amigável.`,
        qualificationCriteria: [
          'Qual é o seu principal desafio hoje?',
          'Há quanto tempo enfrenta esse problema?',
          'Você já tentou alguma solução antes?',
          'Qual seria o impacto de resolver isso?',
          'Qual é o seu orçamento disponível para isso?',
        ],
        language: 'pt-BR',
      },
    });

    // Default subscription
    await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        plan: 'FREE',
        status: 'TRIALING',
        contactsLimit: 100,
        aiTokensLimit: 100000,
        messagesLimit: 1000,
      },
    });

    // Organic lead — created only when phone is provided at signup
    if (phone) {
      await createOrganicLead(tx, { tenantId: tenant.id, name: fullName, email, phone });
    }

    return { tenant, user };
  });

  logger.info({ tenantId: result.tenant.id, email }, 'New tenant registered — pending approval');

  // Account is pending approval — do NOT issue tokens yet.
  // The frontend should show a "awaiting approval" message instead of logging in.
  return {
    pendingApproval: true,
    user: {
      id: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
    },
    tenant: {
      id: result.tenant.id,
      slug: result.tenant.slug,
      name: result.tenant.name,
    },
  };
};

// ── Login ─────────────────────────────────────────────

const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      tenant: {
        select: { id: true, slug: true, name: true, plan: true, status: true }
      }
    }
  });

  if (!user || !user.isActive) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401, expose: true });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401, expose: true });
  }

  if (user.tenant?.status === 'PENDING_APPROVAL') {
    throw Object.assign(new Error('Your account is pending approval. You will be notified once an admin approves your registration.'), { statusCode: 403, expose: true, code: 'PENDING_APPROVAL' });
  }

  if (user.tenant?.status === 'SUSPENDED') {
    throw Object.assign(new Error('Account suspended. Contact support.'), { statusCode: 403, expose: true });
  }

  const accessToken = generateAccessToken(user.id, user.tenantId, user.role);
  const { token: refreshToken, hash } = generateRefreshToken(user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash: hash, lastLoginAt: new Date() },
  });

  logger.info({ userId: user.id, tenantId: user.tenantId }, 'User logged in');

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    },
    tenant: user.tenant,
  };
};

// ── Password reset ─────────────────────────────────────

const requestPasswordReset = async (email) => {
  if (!isPasswordResetEmailConfigured()) {
    throw Object.assign(new Error('Password reset email is not configured yet. Please contact support.'), {
      statusCode: 503,
      expose: true,
    });
  }

  const normalisedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalisedEmail },
    select: { id: true, email: true, isActive: true },
  });

  // Always return the same public response so this endpoint cannot be used
  // to discover which email addresses have ASOS accounts.
  if (!user || !user.isActive) return { requested: true };

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  const resetUrl = new URL(env.PASSWORD_RESET_URL);
  resetUrl.searchParams.set('token', token);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
    },
  });

  try {
    const delivery = await sendPasswordResetEmail({ to: user.email, resetUrl: resetUrl.toString() });
    logger.info({ userId: user.id, emailId: delivery.id }, 'Password reset email accepted by provider');
  } catch (err) {
    await prisma.user.updateMany({
      where: { id: user.id, passwordResetTokenHash: tokenHash },
      data: { passwordResetTokenHash: null, passwordResetExpiresAt: null },
    });
    logger.error({ err, userId: user.id }, 'Password reset email delivery failed');
    throw Object.assign(new Error('We could not send the reset email right now. Please try again shortly.'), {
      statusCode: 502,
      expose: true,
    });
  }

  return { requested: true };
};

const resetPassword = async ({ token, password }) => {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const passwordHash = await bcrypt.hash(password, 12);

  // updateMany makes token consumption atomic: the same link cannot succeed twice.
  const result = await prisma.user.updateMany({
    where: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { gt: new Date() },
      isActive: true,
    },
    data: {
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      refreshTokenHash: null,
    },
  });

  if (result.count !== 1) {
    throw Object.assign(new Error('This reset link is invalid or has expired. Request a new link.'), {
      statusCode: 400,
      expose: true,
    });
  }

  logger.info('Password reset completed and refresh tokens revoked');
  return { changed: true };
};

// ── Refresh access token ──────────────────────────────

const refresh = async (refreshToken) => {
  if (!refreshToken) {
    throw Object.assign(new Error('Refresh token required'), { statusCode: 400, expose: true });
  }

  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const user = await prisma.user.findFirst({
    where: { refreshTokenHash: hash, isActive: true },
    include: { tenant: { select: { id: true, slug: true, name: true, plan: true } } }
  });

  if (!user) {
    throw Object.assign(new Error('Invalid or expired refresh token'), { statusCode: 401, expose: true });
  }

  const accessToken = generateAccessToken(user.id, user.tenantId, user.role);

  return { accessToken, user: { id: user.id, email: user.email, role: user.role } };
};

// ── Google OAuth ──────────────────────────────────────

const googleAuth = async (token) => {
  if (!env.GOOGLE_CLIENT_ID) {
    throw Object.assign(new Error('Google OAuth is not configured'), { statusCode: 503, expose: true });
  }

  const axios = require('axios');
  const { OAuth2Client } = require('google-auth-library');
  const oauthClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

  let googleId;
  let email;
  let fullName;
  let avatarUrl;

  // JWT credential from Google Identity Services / One Tap (three dot-separated segments)
  const parts = String(token).split('.');
  if (parts.length === 3) {
    const ticket = await oauthClient.verifyIdToken({
      idToken: token,
      audience: env.GOOGLE_CLIENT_ID,
    }).catch(() => {
      throw Object.assign(new Error('Invalid Google token'), { statusCode: 401, expose: true });
    });
    const payload = ticket.getPayload();
    googleId = payload.sub;
    email = payload.email;
    fullName = payload.name;
    avatarUrl = payload.picture;
  } else {
    // OAuth access_token from @react-oauth/google useGoogleLogin()
    const { data } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    }).catch(() => {
      throw Object.assign(new Error('Invalid Google token'), { statusCode: 401, expose: true });
    });
    googleId = data.sub;
    email = data.email;
    fullName = data.name;
    avatarUrl = data.picture;
  }

  if (!email) throw Object.assign(new Error('Google account has no email'), { statusCode: 400, expose: true });

  // Find existing user by googleId or email
  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId }, { email }] },
    include: { tenant: { select: { id: true, slug: true, name: true, plan: true, status: true } } },
  });

  let isNewUser = false;

  if (user) {
    // Link googleId if user signed up with email/password before
    if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId, avatarUrl: avatarUrl || user.avatarUrl },
        include: { tenant: { select: { id: true, slug: true, name: true, plan: true, status: true } } },
      });
    }
    if (!user.isActive) throw Object.assign(new Error('Account is deactivated'), { statusCode: 403, expose: true });
    if (user.tenant?.status === 'PENDING_APPROVAL') throw Object.assign(new Error('Your account is pending approval. You will be notified once an admin approves your registration.'), { statusCode: 403, expose: true, code: 'PENDING_APPROVAL' });
    if (user.tenant?.status === 'SUSPENDED') throw Object.assign(new Error('Account suspended. Contact support.'), { statusCode: 403, expose: true });
  } else {
    // New user — create tenant + user in one transaction
    isNewUser = true;
    const baseSlug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const tenantSlug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug: tenantSlug, name: fullName || email, plan: 'FREE', status: 'PENDING_APPROVAL' },
      });
      const newUser = await tx.user.create({
        data: { tenantId: tenant.id, email, googleId, fullName: fullName || email, avatarUrl, role: 'TENANT_ADMIN' },
      });
      await tx.aiConfig.create({
        data: {
          tenantId: tenant.id,
          systemPrompt: `You are a professional AI sales assistant for ${fullName || email}.\nQualify leads, diagnose problems, and guide prospects to the next step.\nBe empathetic, clear, and consultative.`,
          qualificationCriteria: ['What is your main challenge today?', 'How long have you faced this?', 'What is the financial impact?'],
          language: 'en',
        },
      });
      await tx.subscription.create({
        data: { tenantId: tenant.id, plan: 'FREE', status: 'TRIALING', contactsLimit: 100, aiTokensLimit: 100000, messagesLimit: 1000 },
      });
      return { tenant, user: newUser };
    });

    user = { ...result.user, tenant: result.tenant };
    logger.info({ tenantId: result.tenant.id, email }, 'New tenant registered via Google');
  }

  const accessToken = generateAccessToken(user.id, user.tenantId, user.role);
  const { token: refreshToken, hash } = generateRefreshToken(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: hash, lastLoginAt: new Date() } });

  return {
    accessToken,
    refreshToken,
    isNewUser,   // true only for brand-new Google signups — frontend shows phone modal
    user:   { id: user.id, email: user.email, fullName: user.fullName, role: user.role, avatarUrl: user.avatarUrl },
    tenant: user.tenant,
  };
};

// ── Save phone after OAuth (called post-Google-login) ──
// Creates the organic Contact + Lead if phone wasn't collected during signup.

const saveOrganicPhone = async ({ userId, tenantId, phone }) => {
  // Validate E.164 format
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw Object.assign(new Error('Phone must be in E.164 format (e.g. +923001234567)'), { statusCode: 400, expose: true });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404, expose: true });

  // Run in a transaction so Contact + Lead are atomic
  const lead = await prisma.$transaction(async (tx) => {
    return createOrganicLead(tx, {
      tenantId,
      name:  user.fullName || user.email,
      email: user.email,
      phone,
    });
  });

  logger.info({ userId, tenantId, phone }, 'Organic phone lead saved');
  return { lead, phone };
};

// ── Logout ────────────────────────────────────────────

const logout = async (userId) => {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshTokenHash: null },
  });
};

const changePassword = async (userId, { newPassword }) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  if (newPassword.length < 8) throw Object.assign(new Error('New password must be at least 8 characters'), { statusCode: 400 });
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { changed: true };
};

const changeEmail = async (userId, { newEmail, currentPassword }) => {
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw Object.assign(new Error('Please enter a valid email address'), { statusCode: 400, expose: true });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

  // Require current password to confirm identity before changing email
  if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw Object.assign(new Error('Current password is incorrect'), { statusCode: 401, expose: true });
  }

  const normalised = newEmail.toLowerCase().trim();
  if (normalised === user.email.toLowerCase()) {
    throw Object.assign(new Error('New email is the same as your current email'), { statusCode: 400, expose: true });
  }

  // Check new email not already taken
  const taken = await prisma.user.findUnique({ where: { email: normalised } });
  if (taken) throw Object.assign(new Error('This email address is already in use'), { statusCode: 409, expose: true });

  await prisma.user.update({ where: { id: userId }, data: { email: normalised } });

  logger.info({ userId, newEmail: normalised }, 'User email changed');
  return { email: normalised };
};

module.exports = {
  register,
  login,
  requestPasswordReset,
  resetPassword,
  googleAuth,
  refresh,
  logout,
  saveOrganicPhone,
  changePassword,
  changeEmail,
};
