// src/modules/auth/auth.service.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../../config/database');
const env = require('../../config/env');
const logger = require('../../utils/logger');

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

// ── Register new tenant + admin user ─────────────────

const register = async ({ tenantName, tenantSlug, email, password, fullName }) => {
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
        status: 'TRIAL',
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

    return { tenant, user };
  });

  logger.info({ tenantId: result.tenant.id, email }, 'New tenant registered');

  const accessToken = generateAccessToken(result.user.id, result.tenant.id, result.user.role);
  const { token: refreshToken, hash } = generateRefreshToken(result.user.id);

  await prisma.user.update({
    where: { id: result.user.id },
    data: { refreshTokenHash: hash },
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
      role: result.user.role,
    },
    tenant: {
      id: result.tenant.id,
      slug: result.tenant.slug,
      name: result.tenant.name,
      plan: result.tenant.plan,
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

const googleAuth = async (idToken) => {
  const { OAuth2Client } = require('google-auth-library');
  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  }).catch(() => {
    throw Object.assign(new Error('Invalid Google token'), { statusCode: 401, expose: true });
  });

  const payload = ticket.getPayload();
  const { sub: googleId, email, name: fullName, picture: avatarUrl } = payload;

  if (!email) throw Object.assign(new Error('Google account has no email'), { statusCode: 400, expose: true });

  // Find existing user by googleId or email
  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId }, { email }] },
    include: { tenant: { select: { id: true, slug: true, name: true, plan: true, status: true } } },
  });

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
    if (user.tenant?.status === 'SUSPENDED') throw Object.assign(new Error('Account suspended. Contact support.'), { statusCode: 403, expose: true });
  } else {
    // New user — create tenant + user in one transaction
    const baseSlug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const tenantSlug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug: tenantSlug, name: fullName || email, plan: 'FREE', status: 'TRIAL' },
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
    user:   { id: user.id, email: user.email, fullName: user.fullName, role: user.role, avatarUrl: user.avatarUrl },
    tenant: user.tenant,
  };
};

// ── Logout ────────────────────────────────────────────

const logout = async (userId) => {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshTokenHash: null },
  });
};

module.exports = { register, login, googleAuth, refresh, logout };
