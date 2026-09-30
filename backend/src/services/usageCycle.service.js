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
//   maybeAlertUsage     → after every AI reply (conversation.worker.js): tell
//                          the owner once per period at 80% and at 95%
//   usageSummary        → the AI-usage line in the daily digest
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
const redis = require('../config/redis');
const env = require('../config/env');
const logger = require('../utils/logger');
const notificationService = require('./notification.service');
const outbound = require('./outbound.service');
const { isInsideWindow } = require('./agent-guards/never-silent');
const { TOKEN_LIMIT_HANDOFF_REASON } = require('../config/constants');
const { requestContext, runWithSystemScope } = require('../middleware/requestContext.middleware');

// ── Exemption ─────────────────────────────────────────────────────────

// Internal tenants (DSP): tokens are still metered on the subscription, the
// cap is never enforced. Strict boolean — a stringly "true" is not exempt.
// Set by an operator only (migration / SQL); settings.service strips it from
// tenant-admin writes so no one can exempt their own account.
const isBillingExempt = (tenant) => tenant?.settings?.billingExempt === true;

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

// ── Usage thresholds + alerts ─────────────────────────────────────────

const ALERT_THRESHOLDS = [80, 95];
const ALERT_TTL_SECONDS = 40 * 24 * 60 * 60; // outlives any monthly period

// Pure: which alert thresholds `used` has reached. BigInt-safe; no limit
// (0) means nothing to warn about.
const crossedThresholds = (used, limit) => {
  const u = BigInt(used || 0);
  const l = BigInt(limit || 0);
  if (l <= 0n) return [];
  return ALERT_THRESHOLDS.filter((pct) => u * 100n >= l * BigInt(pct));
};

// Stripe tenants' usage resets on their Stripe renewal (the usage period
// never rolls for them), so their cycle is the Stripe period.
const cycleOf = (sub) => (sub.stripeSubId
  ? { start: sub.currentPeriodStart, end: sub.currentPeriodEnd }
  : { start: sub.usagePeriodStart, end: sub.usagePeriodEnd });

// Pure: the digest's view of AI usage. null when there is no limit to show.
const usageSummary = (sub) => {
  if (!sub) return null;
  const used = BigInt(sub.aiTokensUsed || 0);
  const limit = BigInt(sub.aiTokensLimit || 0);
  if (limit <= 0n) return null;
  return {
    used: Number(used),
    limit: Number(limit),
    pct: Number((used * 100n) / limit),
    capped: used >= limit,
    resetsAt: cycleOf(sub).end || null,
  };
};

const fmtTokens = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const fmtDay = (d) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' }).format(d) : null);

const ALERT_LOCK_SECONDS = 60;

// Alert the owner the first time this period that usage crossed 80% / 95%.
// A threshold is marked sent (one Redis key per threshold per period) only
// AFTER a copy was actually delivered; a failed send leaves it unmarked, so
// the next attempt — the next AI reply, or the 5-minute usage tick, which
// matters once the tenant is capped and no replies are left — retries it. A
// short NX lock keeps two concurrent attempts from both sending. When one
// reply jumps both thresholds, ONE message names the higher one and both are
// marked. Delivery goes through notifyAdmin's systemAlert channel: WhatsApp to
// adminPhone (on by default, ignores quiet hours), email fallback to
// alertEmail when the WhatsApp copy doesn't go out (e.g. Meta's 24h window is
// closed). Never throws; called fire-and-forget after processMessage.
const maybeAlertUsage = async (tenant, { sub } = {}) => {
  let lockKey = null;
  try {
    if (!tenant || isBillingExempt(tenant)) return [];
    const s = sub || await prisma.subscription.findUnique({ where: { tenantId: tenant.id } });
    if (!s) return [];
    const crossed = crossedThresholds(s.aiTokensUsed, s.aiTokensLimit);
    if (!crossed.length) return [];

    const cycleKey = cycleOf(s).start ? new Date(cycleOf(s).start).toISOString() : 'no-period';
    const sentKey = (pct) => `asos:usage_alert:${tenant.id}:${cycleKey}:${pct}`;
    const fresh = [];
    for (const pct of crossed) {
      if (!(await redis.get(sentKey(pct)).catch(() => null))) fresh.push(pct);
    }
    if (!fresh.length) return [];

    lockKey = `asos:usage_alert_lock:${tenant.id}:${cycleKey}`;
    if (!(await redis.set(lockKey, '1', 'EX', ALERT_LOCK_SECONDS, 'NX').catch(() => null))) { lockKey = null; return []; }

    const top = Math.max(...fresh);
    const u = usageSummary(s);
    const resets = fmtDay(u.resetsAt);
    const delivery = await notificationService.notifyAdmin(tenant, 'systemAlert', {
      reason: `AI usage has reached ${top}% of this month's plan (${fmtTokens(u.used)} / ${fmtTokens(u.limit)} tokens)`
        + `${resets ? ` — it resets on ${resets}` : ''}.\n\n`
        + 'At 100% the AI stops replying to leads and hands every new conversation to your inbox until the limit is raised or the month resets.\n\n'
        + `Plan & usage: ${env.APP_URL}/billing`,
    });
    if (!delivery?.delivered) {
      logger.warn({ tenantId: tenant.id, thresholds: fresh, pct: u.pct }, 'AI usage alert not delivered — will retry');
      return [];
    }
    await Promise.all(fresh.map((pct) => redis.set(sentKey(pct), '1', 'EX', ALERT_TTL_SECONDS)));
    logger.info({ tenantId: tenant.id, thresholds: fresh, pct: u.pct, via: delivery }, '📈 AI usage threshold alert sent');
    return fresh;
  } catch (err) {
    logger.warn({ err, tenantId: tenant?.id }, 'AI usage alert failed (non-blocking)');
    return [];
  } finally {
    if (lockKey) await redis.del(lockKey).catch(() => {});
  }
};

// The tick's retry path: every non-exempt tenant at ≥80% gets another
// maybeAlertUsage (a no-op once its thresholds are marked). One row per
// tenant in subscriptions, so this scan stays small.
const retryPendingAlerts = async () => {
  const subs = await prisma.subscription.findMany({
    select: { tenantId: true, aiTokensUsed: true, aiTokensLimit: true, stripeSubId: true,
      usagePeriodStart: true, usagePeriodEnd: true, currentPeriodStart: true, currentPeriodEnd: true },
  });
  for (const s of subs) {
    if (!crossedThresholds(s.aiTokensUsed, s.aiTokensLimit).length) continue;
    await requestContext.run({ tenantId: s.tenantId }, async () => {
      const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { id: true, name: true, settings: true } });
      if (tenant) await maybeAlertUsage(tenant, { sub: s });
    });
  }
};

// ── Releasing cap-held conversations ──────────────────────────────────

const hasHeadroom = (tenant, sub) => isBillingExempt(tenant)
  || !sub
  || BigInt(sub.aiTokensUsed || 0) < BigInt(sub.aiTokensLimit || 0);

// At most this many cap-held threads per tenant go back to the AI per tick
// (every 5 min). A month reset can free hundreds at once; pacing them keeps
// the replays from burning the new period in minutes, and headroom is
// re-checked before every batch.
const RELEASE_PER_TICK = 20;

// Only a thread the cap paused, still parked, whose lead is still open. A
// conversation the owner CLOSED (closeConversation keeps handoffReason) or a
// lead marked won/lost during the hold must never be reopened: the replay
// would find no open lead and create a new one from a weeks-old message.
const heldWhere = (tenantId) => ({
  tenantId,
  aiEnabled: false,
  status: 'HUMAN_TAKEOVER',
  handoffReason: TOKEN_LIMIT_HANDOFF_REASON,
  lead: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } },
});

// Hand conversations the cap paused back to the AI, and re-queue the lead's
// newest unanswered message when it can still get a normal reply (inside
// WhatsApp's 24h window — older ones just get the AI back for their next
// message, rather than a wasted turn that can only become a template). A
// thread a human has replied in since the handoff stays with the human.
// Unlike a human handback (conversations.service.js) no asos:ai_control flag
// is set — the thread resumes the normal AI flow it was in before the cap.
// Caller must already be inside this tenant's request context.
const releaseTokenLimitHolds = async (tenant, { now = new Date(), limit = RELEASE_PER_TICK } = {}) => {
  const tenantId = tenant.id;
  const { publishInboundMessage } = require('../queues/message.queue');
  const held = await prisma.conversation.findMany({
    where: heldWhere(tenantId),
    orderBy: { lastMessageAt: 'desc' },   // most recently active first
    select: { id: true, leadId: true, contactId: true, handoffAt: true },
  });

  let released = 0;
  for (const c of held) {
    if (released >= limit) break;

    // A human picked the thread up during the hold → it's theirs.
    const agentReplied = await prisma.message.count({
      where: { conversationId: c.id, tenantId, direction: 'OUTBOUND', sender: 'AGENT', ...(c.handoffAt ? { sentAt: { gt: c.handoffAt } } : {}) },
    });
    if (agentReplied > 0) continue;

    // Guarded on the same conditions as the scan: a human who took over,
    // closed it, or closed the lead since then matches nothing here.
    const { count } = await prisma.conversation.updateMany({
      where: { ...heldWhere(tenantId), id: c.id },
      data: { aiEnabled: true, status: 'AI_HANDLING', handoffReason: null },
    });
    if (!count) continue;
    released += 1;

    await prisma.activity.create({
      data: {
        tenantId,
        leadId: c.leadId,
        type: 'AI_ACTION',
        content: 'AI resumed — token limit cleared (limit raised or new usage period)',
        metadata: { action: 'token_limit_release' },
      },
    }).catch((err) => logger.warn({ err, conversationId: c.id }, 'token-limit release: activity write failed'));

    try {
      const last = await prisma.message.findFirst({
        where: { conversationId: c.id, tenantId, direction: 'INBOUND', sender: 'CONTACT', waMessageId: { not: null } },
        orderBy: { sentAt: 'desc' },
      });
      if (!last || !isInsideWindow(last.sentAt, now)) continue;
      const answeredAfter = c.handoffAt ? new Date(c.handoffAt).toISOString() : null;
      if (await outbound.repliesSince({ tenantId, inbound: last, answeredAfter }) > 0) continue; // a human answered
      const contact = await prisma.contact.findFirst({ where: { id: c.contactId, tenantId }, select: { phone: true, name: true } });
      if (!contact?.phone) continue;
      await publishInboundMessage({
        tenantId,
        phone: contact.phone,
        contactName: contact.name || null,
        content: last.content || '',
        waMessageId: last.waMessageId,
        messageType: 'text',
        timestamp: Math.floor(new Date(last.sentAt).getTime() / 1000).toString(),
        replay: true,
        answeredAfter,
      });
    } catch (err) {
      logger.warn({ err, conversationId: c.id }, 'token-limit release: re-queue failed — AI is back on, next inbound will be answered');
    }
  }

  if (released) logger.info({ tenantId, released }, '♻️ Token-limit holds released back to AI');
  return released;
};

// Every tenant with cap-held threads and headroom again → release them.
// Returns { [tenantId]: releasedCount } for tenants where anything moved.
const releaseAllEligibleHolds = ({ now = new Date() } = {}) => runWithSystemScope(async () => {
  const tenants = await prisma.conversation.findMany({
    where: { aiEnabled: false, status: 'HUMAN_TAKEOVER', handoffReason: TOKEN_LIMIT_HANDOFF_REASON },
    select: { tenantId: true },
    distinct: ['tenantId'],
  });
  const out = {};
  for (const { tenantId } of tenants) {
    await requestContext.run({ tenantId }, async () => {
      const [tenant, sub] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, settings: true } }),
        prisma.subscription.findUnique({ where: { tenantId } }),
      ]);
      if (!tenant || !hasHeadroom(tenant, sub)) return;
      const n = await releaseTokenLimitHolds(tenant, { now }).catch((err) => {
        logger.error({ err, tenantId }, 'token-limit release failed');
        return 0;
      });
      if (n) out[tenantId] = n;
    });
  }
  return out;
});

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
  const released = await releaseAllEligibleHolds({ now });
  await retryPendingAlerts().catch((err) => logger.warn({ err }, 'usage alert retry failed'));
  return { reset, released };
});

module.exports = {
  isBillingExempt,
  crossedThresholds,
  usageSummary,
  maybeAlertUsage,
  addMonthsClamped,
  rollPeriod,
  periodContaining,
  hasHeadroom,
  RELEASE_PER_TICK,
  releaseTokenLimitHolds,
  releaseAllEligibleHolds,
  runUsageTick,
};
