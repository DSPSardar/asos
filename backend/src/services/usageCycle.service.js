// src/services/usageCycle.service.js
// The AI-usage billing cycle — everything that keeps a tenant from silently
// going dark on an old token counter.
//
//   runUsageTick        → the 5-minute 'usage-tick' scheduler job
//                          (queues/message.queue.js registerUsageTick):
//                            1. initialise usage periods that don't exist yet
//                            2. roll expired periods forward, reset counters
//                            3. release conversations the cap paused, for any
//                               tenant that has headroom again
//
// usagePeriodStart/End is the tenant's USAGE cycle, deliberately separate from
// currentPeriodStart/End, which is the paid-through date (Stripe, or a manual
// bank-transfer payment that can cover several months at once). Rolling the
// paid-through date forward would claim months nobody paid for.
//
// Stripe tenants are skipped by the reset: their invoice.payment_succeeded
// webhook already zeroes the counters on renewal (billing.service.js).
//
// RLS: the scans run under runWithSystemScope; every per-tenant write runs
// inside requestContext.run({ tenantId }) so Postgres sees that tenant only.

const prisma = require('../config/database');
const logger = require('../utils/logger');
const { requestContext, runWithSystemScope } = require('../middleware/requestContext.middleware');

// ── Period arithmetic (pure) ──────────────────────────────────────────

// base + k months, day clamped to the month's length (Jan 31 + 1 → Feb 28).
const addMonthsClamped = (base, k, anchorDay) => {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + k;
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, daysInMonth),
    base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), base.getUTCMilliseconds()));
};

// Next period for an expired one, jumping any number of missed months in one
// step. The anchor day is the larger of the two ends: a clamped period
// (Feb 28 → Mar 31) still carries the true anchor in its unclamped end, so a
// 31st-anchored cycle never drifts to the 28th.
const rollPeriod = ({ start, end, now }) => {
  if (end > now) return { start, end, rolled: false };
  const anchorDay = Math.max(start.getUTCDate(), end.getUTCDate());
  let k = 1;
  while (addMonthsClamped(start, k + 1, anchorDay) <= now) k++;
  return { start: addMonthsClamped(start, k, anchorDay), end: addMonthsClamped(start, k + 1, anchorDay), rolled: true };
};

// The period containing `now` for a cycle anchored on `anchor` (used to
// initialise subscriptions created without one).
const periodContaining = (anchor, now) => {
  const first = { start: anchor, end: addMonthsClamped(anchor, 1, anchor.getUTCDate()) };
  if (anchor > now) return first;
  const r = rollPeriod({ ...first, now });
  return { start: r.start, end: r.end };
};

// ── The tick ──────────────────────────────────────────────────────────

const initialiseMissingPeriods = async (now) => {
  const missing = await prisma.subscription.findMany({
    where: { usagePeriodEnd: null },
    select: { tenantId: true, createdAt: true },
  });
  for (const s of missing) {
    const p = periodContaining(new Date(s.createdAt || now), now);
    await requestContext.run({ tenantId: s.tenantId }, () => prisma.subscription.updateMany({
      where: { tenantId: s.tenantId, usagePeriodEnd: null },
      data: { usagePeriodStart: p.start, usagePeriodEnd: p.end },
    }));
  }
};

const resetExpiredPeriods = async (now) => {
  const due = await prisma.subscription.findMany({
    where: { stripeSubId: null, usagePeriodEnd: { lte: now } },
    select: { tenantId: true, usagePeriodStart: true, usagePeriodEnd: true },
  });
  const reset = [];
  for (const s of due) {
    const next = rollPeriod({ start: s.usagePeriodStart || s.usagePeriodEnd, end: s.usagePeriodEnd, now });
    // Guarded on the period we read: a concurrent tick (or a retried job)
    // that already rolled this period matches zero rows and does nothing.
    const { count } = await requestContext.run({ tenantId: s.tenantId }, () => prisma.subscription.updateMany({
      where: { tenantId: s.tenantId, usagePeriodEnd: s.usagePeriodEnd },
      data: { aiTokensUsed: 0n, messagesUsed: 0, usagePeriodStart: next.start, usagePeriodEnd: next.end },
    }));
    if (count) {
      reset.push(s.tenantId);
      logger.info({ tenantId: s.tenantId, periodStart: next.start, periodEnd: next.end }, '🔄 Usage period rolled — AI token + message counters reset');
    }
  }
  return reset;
};

const runUsageTick = ({ now = new Date() } = {}) => runWithSystemScope(async () => {
  await initialiseMissingPeriods(now);
  const reset = await resetExpiredPeriods(now);
  return { reset };
});

module.exports = {
  addMonthsClamped,
  rollPeriod,
  periodContaining,
  runUsageTick,
};
