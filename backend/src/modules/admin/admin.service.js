// src/modules/admin/admin.service.js
// Superadmin only — platform-wide management

const prisma  = require('../../config/database');
const bcrypt  = require('bcryptjs');

const listTenants = async ({ search, plan, status, page = 1, limit = 20 }) => {
  const where = {
    ...(plan   && { plan }),
    ...(status && { status }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count:       { select: { users: true, leads: true, contacts: true } },
        subscription: { select: { plan: true, status: true, aiTokensUsed: true, aiTokensLimit: true } },
        users:        { where: { role: 'TENANT_ADMIN' }, select: { id: true, email: true, fullName: true }, take: 1 },
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  return { tenants, total };
};

const getTenant = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      users:        { select: { id: true, email: true, role: true, isActive: true, lastLoginAt: true } },
      subscription: true,
      _count:       { select: { leads: true, contacts: true, conversations: true, messages: true } },
    },
  });
  if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404, expose: true });
  return tenant;
};

const updateTenant = async (tenantId, data) => {
  const allowed = ['plan', 'status', 'name'];
  const update = {};
  allowed.forEach(k => { if (data[k] !== undefined) update[k] = data[k]; });

  // If plan changes, update subscription limits too
  if (data.plan) {
    const planLimits = {
      FREE:       { contactsLimit: 100,   aiTokensLimit: 100000,    messagesLimit: 1000  },
      PRO:        { contactsLimit: 5000,  aiTokensLimit: 5000000,   messagesLimit: 50000 },
      ENTERPRISE: { contactsLimit: 99999, aiTokensLimit: 100000000, messagesLimit: 999999 },
    };

    await prisma.subscription.upsert({
      where:  { tenantId },
      create: { tenantId, plan: data.plan, status: 'ACTIVE', ...planLimits[data.plan] },
      update: { plan: data.plan, ...planLimits[data.plan] },
    });
  }

  return prisma.tenant.update({ where: { id: tenantId }, data: update });
};

const getPlatformMetrics = async () => {
  const [
    totalTenants,
    activeTenants,
    totalLeads,
    totalMessages,
    aiMessages,
    planDist,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: 'ACTIVE' } }),
    prisma.lead.count(),
    prisma.message.count(),
    prisma.message.count({ where: { sender: 'AI' } }),
    prisma.tenant.groupBy({ by: ['plan'], _count: { id: true } }),
  ]);

  return {
    tenants:  { total: totalTenants, active: activeTenants },
    leads:    { total: totalLeads },
    messages: { total: totalMessages, aiHandled: aiMessages },
    planDistribution: planDist.map(p => ({ plan: p.plan, count: p._count.id })),
  };
};

// ── Approve a pending tenant ──────────────────────────
const approveTenant = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
  if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404, expose: true });
  if (tenant.status !== 'PENDING_APPROVAL') throw Object.assign(new Error('Tenant is not pending approval'), { statusCode: 400, expose: true });

  return prisma.tenant.update({
    where: { id: tenantId },
    data:  { status: 'TRIAL' },
    include: { users: { select: { email: true } } },
  });
};

// ── Reject a pending tenant (suspends it, keeps record for audit) ─
const rejectTenant = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
  if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404, expose: true });
  if (tenant.status !== 'PENDING_APPROVAL') throw Object.assign(new Error('Tenant is not pending approval'), { statusCode: 400, expose: true });

  return prisma.tenant.update({
    where: { id: tenantId },
    data:  { status: 'SUSPENDED' },
  });
};

// ── Update tenant admin user (email, name, password) ──────────
const updateTenantAdmin = async (tenantId, { fullName, email, newPassword }) => {
  const adminUser = await prisma.user.findFirst({
    where: { tenantId, role: 'TENANT_ADMIN' },
    select: { id: true, email: true },
  });
  if (!adminUser) throw Object.assign(new Error('Admin user not found for this tenant'), { statusCode: 404, expose: true });

  const data = {};
  if (fullName?.trim()) data.fullName = fullName.trim();

  if (email?.trim()) {
    const normalised = email.trim().toLowerCase();
    const taken = await prisma.user.findUnique({ where: { email: normalised } });
    if (taken && taken.id !== adminUser.id) {
      throw Object.assign(new Error('Email is already in use by another account'), { statusCode: 409, expose: true });
    }
    data.email = normalised;
  }

  if (newPassword?.trim()) {
    if (newPassword.length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { statusCode: 400, expose: true });
    data.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  if (Object.keys(data).length === 0) {
    throw Object.assign(new Error('No fields to update'), { statusCode: 400, expose: true });
  }

  const updated = await prisma.user.update({ where: { id: adminUser.id }, data });
  return { id: updated.id, email: updated.email, fullName: updated.fullName };
};

// ── Delete tenant + all associated data ───────────────────────
const deleteTenant = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
  if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404, expose: true });

  await prisma.$transaction(async (tx) => {
    // Conversations have child records — delete those first
    const convIds = (await tx.conversation.findMany({ where: { tenantId }, select: { id: true } })).map(c => c.id);
    if (convIds.length > 0) {
      await tx.message.deleteMany({ where: { conversationId: { in: convIds } } });
      await tx.aiAgentLog.deleteMany({ where: { conversationId: { in: convIds } } });
    }
    await tx.activity.deleteMany({ where: { tenantId } });
    await tx.adsTracking.deleteMany({ where: { tenantId } });
    await tx.conversation.deleteMany({ where: { tenantId } });
    await tx.lead.deleteMany({ where: { tenantId } });
    await tx.contact.deleteMany({ where: { tenantId } });
    await tx.aiConfig.deleteMany({ where: { tenantId } });
    await tx.subscription.deleteMany({ where: { tenantId } });
    await tx.user.deleteMany({ where: { tenantId } });
    await tx.tenant.delete({ where: { id: tenantId } });
  });

  return { deleted: true, name: tenant.name };
};

module.exports = { listTenants, getTenant, updateTenant, getPlatformMetrics, approveTenant, rejectTenant, updateTenantAdmin, deleteTenant };
