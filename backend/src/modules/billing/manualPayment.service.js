// manualPayment.service.js — bank-transfer payments from tenants to us.
//
// Stripe cannot receive payments for a Pakistani business, so this is the real
// billing path, not a fallback. Clients transfer to the company account and
// send a screenshot; an admin verifies it against the bank statement and
// approves, which is what actually activates or extends their plan.
//
// The Stripe code in billing.service.js is left in place and untouched — it
// still works for any future non-PK customer — but nothing here depends on it.
const prisma = require('../../config/database');
const logger = require('../../utils/logger');

// Kept deliberately in step with PLANS in billing.service.js and the planLimits
// map in admin.service.js. Those two already disagreed on nothing but format;
// this is the third copy, so if a fourth appears, extract it.
const PLAN_LIMITS = {
  FREE:       { contactsLimit: 100,   aiTokensLimit: 100_000n,     messagesLimit: 1_000   },
  PRO:        { contactsLimit: 5_000, aiTokensLimit: 5_000_000n,   messagesLimit: 50_000  },
  ENTERPRISE: { contactsLimit: 99_999, aiTokensLimit: 100_000_000n, messagesLimit: 999_999 },
};

// Never send image bytes in a list response — a page of 20 screenshots would
// be tens of megabytes of base64. The image is fetched one at a time.
const LIST_FIELDS = {
  id: true, tenantId: true, amount: true, currency: true, paidAt: true,
  reference: true, plan: true, periodMonths: true, status: true, notes: true,
  reviewedById: true, reviewedAt: true, reviewNote: true, createdAt: true,
  proofMimeType: true, proofFilename: true,
};

// Decimal and BigInt do not survive JSON.stringify. Convert at the boundary.
const serialize = (p) => (!p ? null : {
  ...p,
  amount: p.amount == null ? null : Number(p.amount),
  hasProof: Boolean(p.proofMimeType),
});

// ── Tenant side ───────────────────────────────────────────────

const submitPayment = async (tenantId, { amount, currency, paidAt, reference, plan, periodMonths, notes, proof }) => {
  const created = await prisma.manualPayment.create({
    data: {
      tenantId,
      amount,
      currency: currency || 'PKR',
      paidAt: new Date(paidAt),
      reference: reference || null,
      plan,
      periodMonths: periodMonths || 1,
      notes: notes || null,
      proofImage: proof?.buffer || null,
      proofMimeType: proof?.mimetype || null,
      proofFilename: proof?.originalname || null,
      status: 'PENDING',
    },
    select: LIST_FIELDS,
  });

  logger.info({ event: 'billing.manual_payment.submitted', tenantId, paymentId: created.id, plan, amount }, 'Manual payment submitted for review');
  return serialize(created);
};

const listForTenant = async (tenantId) => {
  const rows = await prisma.manualPayment.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: LIST_FIELDS,
  });
  return rows.map(serialize);
};

// ── Admin side ────────────────────────────────────────────────

const listAll = async ({ status, page = 1, limit = 20 }) => {
  const where = status ? { status } : {};
  const [rows, total] = await Promise.all([
    prisma.manualPayment.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: { ...LIST_FIELDS, tenant: { select: { id: true, name: true, slug: true, plan: true, status: true } } },
    }),
    prisma.manualPayment.count({ where }),
  ]);
  return { payments: rows.map(serialize), total, page, limit };
};

// Returns the raw image. Superadmin only — see admin.routes.js.
const getProof = async (paymentId) => prisma.manualPayment.findUnique({
  where: { id: paymentId },
  select: { proofImage: true, proofMimeType: true, proofFilename: true },
});

// Approving is what actually grants access. It sets currentPeriodEnd, which
// the previous hand-edit path never did — that is the difference between a
// subscription that lapses and one that silently runs free forever.
//
// Extension stacks from the later of (existing period end, now), so approving
// a renewal early does not throw away the remaining paid days.
const approve = async (paymentId, reviewerId) => {
  const payment = await prisma.manualPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw Object.assign(new Error('Payment not found'), { statusCode: 404, expose: true });
  if (payment.status !== 'PENDING') {
    throw Object.assign(new Error(`Payment already ${payment.status.toLowerCase()}`), { statusCode: 409, expose: true });
  }

  const limits = PLAN_LIMITS[payment.plan] || PLAN_LIMITS.PRO;
  const existing = await prisma.subscription.findUnique({ where: { tenantId: payment.tenantId } });

  const now = new Date();
  const base = existing?.currentPeriodEnd && existing.currentPeriodEnd > now
    ? existing.currentPeriodEnd
    : now;
  const periodEnd = new Date(base);
  periodEnd.setMonth(periodEnd.getMonth() + payment.periodMonths);

  await prisma.$transaction([
    prisma.manualPayment.update({
      where: { id: paymentId },
      data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: now },
    }),
    prisma.subscription.upsert({
      where: { tenantId: payment.tenantId },
      create: {
        tenantId: payment.tenantId,
        plan: payment.plan,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        ...limits,
      },
      update: {
        plan: payment.plan,
        status: 'ACTIVE',
        currentPeriodStart: existing?.currentPeriodStart ?? now,
        currentPeriodEnd: periodEnd,
        ...limits,
      },
    }),
    // Tenant.status is what requireActiveTenant gates on, so a tenant still
    // sitting in PENDING_APPROVAL or TRIAL has to be moved to ACTIVE here or
    // they stay locked out despite having paid.
    prisma.tenant.update({
      where: { id: payment.tenantId },
      data: { plan: payment.plan, status: 'ACTIVE' },
    }),
  ]);

  logger.info(
    { event: 'billing.manual_payment.approved', tenantId: payment.tenantId, paymentId, plan: payment.plan, amount: Number(payment.amount), periodEnd, reviewerId },
    'Manual payment approved — plan activated'
  );

  return { id: paymentId, status: 'APPROVED', periodEnd };
};

const reject = async (paymentId, reviewerId, reviewNote) => {
  const payment = await prisma.manualPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw Object.assign(new Error('Payment not found'), { statusCode: 404, expose: true });
  if (payment.status !== 'PENDING') {
    throw Object.assign(new Error(`Payment already ${payment.status.toLowerCase()}`), { statusCode: 409, expose: true });
  }

  await prisma.manualPayment.update({
    where: { id: paymentId },
    data: { status: 'REJECTED', reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: reviewNote || null },
  });

  logger.info({ event: 'billing.manual_payment.rejected', tenantId: payment.tenantId, paymentId, reviewerId, reviewNote: reviewNote || null }, 'Manual payment rejected');
  return { id: paymentId, status: 'REJECTED' };
};

module.exports = {
  PLAN_LIMITS,
  submitPayment,
  listForTenant,
  listAll,
  getProof,
  approve,
  reject,
};
