// src/modules/admin/admin.service.js
// Superadmin only — platform-wide management

const prisma = require('../../config/database');

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
        _count: { select: { users: true, leads: true, contacts: true } },
        subscription: { select: { plan: true, status: true, aiTokensUsed: true, aiTokensLimit: true } },
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

module.exports = { listTenants, getTenant, updateTenant, getPlatformMetrics };
