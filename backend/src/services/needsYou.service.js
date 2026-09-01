// src/services/needsYou.service.js
// IO half of "who needs a human today". Loads the candidate rows for one
// tenant (inside the caller's RLS context — an authenticated request, or a
// background job that already did runWithSystemScope → requestContext.run)
// and hands them to the pure selection in needsYou.select.js.
//
// Nothing in this file sends a message or calls an AI model. Drafts and
// summaries are generated on demand by modules/today (one row at a time,
// cached), never in bulk here — real student threads run 130–190 messages
// and a page load must not cost a tenant's token budget.
const prisma = require('../config/database');
const { Prisma } = require('@prisma/client');
const redis = require('../config/redis');
const select = require('./needsYou.select');
const { normalizeSteps } = require('./automation.steps');

const { DAY_MS, LOOKBACK_DAYS, STALL_MAX_DAYS, OPEN_STAGES } = select;
const CANDIDATE_CAP = 600;          // conversations scanned per tenant
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

const pktDayKey = (now = new Date()) => new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);

// "Skip today" — per viewer, per PKT day. Expires on its own.
const snoozeKey = (tenantId, userId, now) => `today:skip:${tenantId}:${userId}:${pktDayKey(now)}`;
const loadSnoozed = async (tenantId, userId, now) => {
  try { return new Set(await redis.smembers(snoozeKey(tenantId, userId, now))); } catch { return new Set(); }
};
const snooze = async (tenantId, userId, conversationId, now = new Date()) => {
  const key = snoozeKey(tenantId, userId, now);
  await redis.sadd(key, conversationId);
  await redis.expire(key, 36 * 60 * 60);
  return { conversationId, until: pktDayKey(new Date(now.getTime() + DAY_MS)) };
};
const unsnooze = async (tenantId, userId, conversationId, now = new Date()) => {
  await redis.srem(snoozeKey(tenantId, userId, now), conversationId).catch(() => {});
  return { conversationId };
};

// "Dismiss" — hidden until the lead writes again. Tenant-wide (a dismissed
// backlog row should not reappear for a colleague), keyed on the latest
// message id so any new message brings the row back. 60-day TTL.
const dismissKey = (tenantId) => `today:dismiss:${tenantId}`;
const loadDismissed = async (tenantId) => {
  try { return new Map(Object.entries(await redis.hgetall(dismissKey(tenantId)) || {})); } catch { return new Map(); }
};
const dismiss = async (tenantId, conversationId, latestMessageId) => {
  await redis.hset(dismissKey(tenantId), conversationId, latestMessageId || 'none');
  await redis.expire(dismissKey(tenantId), 60 * 24 * 60 * 60);
  return { conversationId, until: 'they write again' };
};
const undismiss = async (tenantId, conversationId) => {
  await redis.hdel(dismissKey(tenantId), conversationId).catch(() => {});
  return { conversationId };
};

// The sequence columns on automation_runs (migration 20260902000000) may
// lag the code by one deploy — or be absent entirely when this runs from a
// Mac against production before the push. Check once per process instead
// of letting Prisma log a failed query on every page load.
let sequenceSchemaReady = null;
const sequencesAvailable = async () => {
  if (sequenceSchemaReady !== null) return sequenceSchemaReady;
  try {
    const rows = await prisma.$transaction(async (tx) => tx.$queryRaw`
      SELECT 1 AS ok FROM information_schema.columns
      WHERE table_name = 'automation_runs' AND column_name = 'next_due_at' LIMIT 1`);
    sequenceSchemaReady = rows.length > 0;
  } catch { sequenceSchemaReady = false; }
  return sequenceSchemaReady;
};

// Leads currently mid-automation-sequence: leadId → { ruleName, step, total, nextDueAt }.
const loadSequences = async (tenantId, leadIds) => {
  if (!leadIds.length || !(await sequencesAvailable())) return {};
  const runs = await prisma.automationRun.findMany({
    where: { tenantId, status: 'ACTIVE', leadId: { in: leadIds } },
    select: { leadId: true, step: true, nextDueAt: true, rule: { select: { name: true, action: true } } },
  }).catch(() => []);
  const out = {};
  for (const r of runs) {
    out[r.leadId] = { ruleName: r.rule?.name || 'Automation', step: r.step, total: normalizeSteps(r.rule?.action || {}).length, nextDueAt: r.nextDueAt };
  }
  return out;
};

// Latest INBOUND per conversation (24h-window check + the lead's last words).
// Prisma can't include the same relation twice with different filters, so
// this is a second, narrow query over just the candidate ids.
//
// DISTINCT ON in SQL, not Prisma's `distinct` — Prisma dedupes in memory,
// which would pull every inbound message of 600 threads (real student threads
// run 130–190 messages) just to keep one row each. The interactive
// $transaction is the RLS-safe raw path: config/database.js sets the tenant
// context at the start of it.
const loadLastInbound = async (tenantId, conversationIds) => {
  if (!conversationIds.length) return new Map();
  const rows = await prisma.$transaction(async (tx) => tx.$queryRaw`
    SELECT DISTINCT ON (conversation_id) conversation_id AS "conversationId", sent_at AS "sentAt", content
    FROM messages
    WHERE tenant_id = ${tenantId} AND direction = 'INBOUND' AND conversation_id IN (${Prisma.join(conversationIds)})
    ORDER BY conversation_id, sent_at DESC
  `);
  return new Map(rows.map((r) => [r.conversationId, r]));
};

/**
 * Build the queue for one tenant as seen by `viewer` ({ userId, role }).
 * Runs inside the caller's RLS context.
 */
const collectQueue = async (tenantId, { viewer = null, now = new Date(), includeSnoozed = false } = {}) => {
  // Candidates go back as far as the awaiting scan (30d): a handoff nobody
  // answered three weeks ago is still owed a reply. The pure selection
  // applies the shorter 14-day window to the quiet group itself.
  const quietLookback = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  const lookback = new Date(now.getTime() - Math.max(LOOKBACK_DAYS, select.AWAITING_LOOKBACK_DAYS) * DAY_MS);
  const stallActiveSince = new Date(now.getTime() - STALL_MAX_DAYS * DAY_MS);

  const convSelect = {
    id: true, status: true, aiEnabled: true, lastMessageAt: true, paymentProofDetected: true,
    lead: { select: { id: true, stage: true, aiScore: true, scoreLabel: true, problemSummary: true, assignedTo: true, contact: { select: { name: true, phone: true } } } },
    messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { id: true, direction: true, sender: true, sentAt: true, content: true } },
  };
  const [recent, olderOwed, openLeads, snoozed, dismissed] = await Promise.all([
    // Follow-up candidates: anything with activity in the 14-day window.
    prisma.conversation.findMany({
      where: { tenantId, lastMessageAt: { gte: quietLookback }, lead: { stage: { not: 'CLOSED_LOST' } } },
      orderBy: { lastMessageAt: 'desc' },
      take: CANDIDATE_CAP,
      select: convSelect,
    }),
    // Older threads a human may still owe a reply on (14–30 days): only the
    // parked / handed-over / AI-off ones. Kept separate so DSP's volume of
    // ordinary old threads can't push these past the candidate cap — the
    // second dry run lost two 3-week-old "confirm my seat" handoffs that way.
    prisma.conversation.findMany({
      where: {
        tenantId, lastMessageAt: { gte: lookback, lt: quietLookback }, lead: { stage: { not: 'CLOSED_LOST' } },
        OR: [{ status: { in: ['PENDING_VERIFICATION', 'HUMAN_TAKEOVER'] } }, { aiEnabled: false }],
      },
      orderBy: { lastMessageAt: 'desc' },
      take: CANDIDATE_CAP,
      select: convSelect,
    }),
    // Stall candidates: open leads that talked to us within the stall ceiling.
    prisma.lead.findMany({
      where: { tenantId, stage: { in: OPEN_STAGES }, conversations: { some: { lastMessageAt: { gte: stallActiveSince } } } },
      select: {
        id: true, stage: true, aiScore: true, scoreLabel: true, updatedAt: true, problemSummary: true, assignedTo: true,
        contact: { select: { name: true, phone: true } },
        conversations: {
          orderBy: { lastMessageAt: 'desc' }, take: 1,
          select: {
            id: true, status: true, aiEnabled: true, lastMessageAt: true,
            messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { id: true, direction: true, sender: true, sentAt: true, content: true } },
          },
        },
      },
    }),
    viewer?.userId && !includeSnoozed ? loadSnoozed(tenantId, viewer.userId, now) : new Set(),
    includeSnoozed ? new Map() : loadDismissed(tenantId),
  ]);
  const seen = new Set();
  const convs = [...recent, ...olderOwed].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  const openIds = openLeads.map((l) => l.id);
  const historyRows = openIds.length
    ? await prisma.leadStageHistory.findMany({
      where: { tenantId, leadId: { in: openIds } },
      orderBy: { createdAt: 'desc' },
      select: { leadId: true, toStage: true, createdAt: true },
    })
    : [];

  // Last inbound for every candidate conversation (both sources).
  const convIds = [...new Set([...convs.map((c) => c.id), ...openLeads.map((l) => l.conversations?.[0]?.id).filter(Boolean)])];
  const lastInbound = await loadLastInbound(tenantId, convIds);
  const decorate = (c) => {
    const li = lastInbound.get(c.id);
    return { ...c, lastInboundAt: li?.sentAt || null, lastInboundText: li?.content || '' };
  };
  const convRows = convs.map(decorate);
  const leadRows = openLeads.map((l) => ({ ...l, conversations: l.conversations.map(decorate) }));

  const leadIds = [...new Set([...convRows.map((c) => c.lead?.id), ...leadRows.map((l) => l.id)].filter(Boolean))];
  const sequences = await loadSequences(tenantId, leadIds);

  const queue = select.buildQueue({ convs: convRows, openLeads: leadRows, historyRows, sequences, snoozed, dismissed }, now, { viewer });

  // Context for the empty state: what the machine is handling for you.
  const [handledByAi, inSequences] = await Promise.all([
    prisma.conversation.count({ where: { tenantId, aiEnabled: true, status: { in: ['ACTIVE', 'AI_HANDLING'] }, lastMessageAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    (await sequencesAvailable()) ? prisma.automationRun.count({ where: { tenantId, status: 'ACTIVE' } }).catch(() => 0) : 0,
  ]);

  return { ...queue, now, day: pktDayKey(now), context: { handledByAi, inSequences } };
};

module.exports = { collectQueue, snooze, unsnooze, loadSnoozed, dismiss, undismiss, loadDismissed, pktDayKey, CANDIDATE_CAP };
