// src/services/automation.service.js
// The IF/THEN automation engine behind /automations.
//
// Runs as a repeatable 'automation-tick' job on the scheduler queue (every
// TICK_MINUTES). Each tick, for every tenant with at least one enabled rule:
//   1. advanceDue(rule)   → leads mid-sequence whose next touch is due
//   2. findMatches(rule)  → leads whose trigger condition is satisfied (enrol)
//   3. for each           → send WhatsApp, persist OUTBOUND message + Activity,
//                           write/update the automation_runs row
//
// Multi-touch sequences: a rule's action may carry `steps`
//   [{ delay, unit, template, waTemplate? }, ...]
// Step 0 fires when the trigger matches (exactly what a plain rule does);
// each later step fires `delay` after the PREVIOUS touch, unless the lead
// replied in between. The automation_runs row is the lead's enrolment — the
// unique (rule, lead) key is the once-per-lead-ever guard — and it carries
// the progress: step (touches sent), nextDueAt, lastTouchAt, status ACTIVE
// while more touches are pending, SENT when the last one went out,
// CANCELLED (cancelReason) when the sequence stopped early. A rule without
// `steps` is a one-step sequence, so nothing about existing rules changed.
//
// Safety rails (all deliberate — a rule can reach every lead in a tenant):
//   - a rule enrols a lead at most ONCE, ever (unique rule_id+lead_id)
//   - only events at/after rule.enabledAt count; enabling never replays history
//   - LOOKBACK caps how far back time-based triggers scan
//   - MAX_SENDS_PER_RULE_PER_TICK caps blast size (advance + enrol share it;
//     due touches go first so a new blast never starves a lead mid-sequence)
//   - conversations in HUMAN_TAKEOVER / PENDING_VERIFICATION / aiEnabled=false
//     and CLOSED_LOST leads are never touched
//   - CLOSED_WON leads are never CHASED (no_reply / no_activity); lifecycle
//     triggers still reach them, so enrolled students keep getting welcome,
//     certificate and Mastery nudges
//   - a pending sequence is cancelled the moment the lead replies (the inbound
//     worker calls cancelSequencesForLead; advanceDue re-checks as a backstop),
//     when a human agent messages them, or when the lead/conversation becomes
//     ineligible (won, lost, handed to a human, AI off)
//   - Meta only delivers free-form text inside the 24h customer-service
//     window. Outside it we record SKIPPED(outside_24h_window) instead of
//     burning a send that Meta will reject with error 131047.
const prisma = require('../config/database');
const logger = require('../utils/logger');
const whatsappService = require('./whatsapp.service');
const { requestContext, runWithSystemScope } = require('../middleware/requestContext.middleware');

const {
  UNIT_MS, delayMs, UNTOUCHABLE_CONV, CANCEL_REASONS,
  normalizeSteps, validateSteps, planAfterTouch, cancelReasonFor, isChaseTrigger,
} = require('./automation.steps');

const TICK_MINUTES = 10;
const LOOKBACK_DAYS = 14;
const MAX_SENDS_PER_RULE_PER_TICK = 50;
const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

const renderTemplate = (tpl, lead) => {
  const name = (lead.contact?.name || '').trim().split(/\s+/)[0] || 'dost';
  return String(tpl || '').replace(/\{name\}/gi, name).replace(/\{stage\}/gi, lead.stage || '');
};

const leadSelect = {
  id: true, tenantId: true, stage: true, dspPhase: true, updatedAt: true,
  contact: { select: { id: true, name: true, phone: true } },
  conversations: {
    orderBy: { lastMessageAt: 'desc' }, take: 1,
    select: { id: true, status: true, aiEnabled: true, lastMessageAt: true },
  },
};

// Latest message direction + last inbound / last human-agent time, for the
// 24h-window check and the sequence cancel rules.
const conversationFacts = async (conversationId) => {
  const [last, lastInbound, lastAgent] = await Promise.all([
    prisma.message.findFirst({ where: { conversationId }, orderBy: { sentAt: 'desc' }, select: { direction: true, sentAt: true } }),
    prisma.message.findFirst({ where: { conversationId, direction: 'INBOUND' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
    prisma.message.findFirst({ where: { conversationId, direction: 'OUTBOUND', sender: 'AGENT' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
  ]);
  return { last, lastInboundAt: lastInbound?.sentAt || null, lastAgentAt: lastAgent?.sentAt || null };
};

// Common lead filter shared by every trigger type.
//
// excludeWon: chase triggers (no_reply / no_activity) must never nudge someone
// who has already bought — a paid student asked "aap ne course ke baare mein
// pucha tha, koi sawaal hai?" reads as a bot that doesn't know they enrolled.
// Lifecycle triggers (stage_entered / dsp_phase_changed / mastery_event) are
// SUPPOSED to reach enrolled students, so they leave this off. An explicit
// condition.stage still wins over both defaults.
const baseLeadWhere = (rule, { excludeWon = false } = {}) => {
  const skipStages = excludeWon ? ['CLOSED_LOST', 'CLOSED_WON'] : ['CLOSED_LOST'];
  const where = { tenantId: rule.tenantId, stage: { notIn: skipStages } };
  const condStage = rule.condition?.stage;
  if (condStage && condStage !== 'any') where.stage = condStage;
  // Never re-fire on a lead this rule already touched.
  where.automationRuns = { none: { ruleId: rule.id } };
  return where;
};

/**
 * Returns [{ lead, insideWindow, conversationId }] for leads that satisfy
 * the rule right now. Pure read — never sends.
 */
const findMatches = async (rule, { limit = MAX_SENDS_PER_RULE_PER_TICK, ignoreEnabledAt = false, now = new Date() } = {}) => {
  const t = rule.trigger || {};
  const since = ignoreEnabledAt || !rule.enabledAt ? new Date(now - LOOKBACK_DAYS * UNIT_MS.days) : rule.enabledAt;
  const lookback = new Date(now - LOOKBACK_DAYS * UNIT_MS.days);
  const floor = since > lookback ? since : lookback;
  const cutoff = new Date(now - delayMs(t));
  const out = [];
  if (limit <= 0) return out;

  const push = async (lead) => {
    const conv = lead.conversations?.[0];
    if (!conv || !conv.aiEnabled || UNTOUCHABLE_CONV.includes(conv.status)) return;
    const facts = await conversationFacts(conv.id);
    const insideWindow = !!facts.lastInboundAt && (now - facts.lastInboundAt) < WA_WINDOW_MS;
    out.push({ lead, conversationId: conv.id, insideWindow, facts });
  };

  if (t.type === 'stage_entered') {
    // One row per transition, so "entered stage X, delay ago" is exact.
    const rows = await prisma.leadStageHistory.findMany({
      where: { tenantId: rule.tenantId, toStage: t.stage, createdAt: { gte: floor, lte: cutoff } },
      orderBy: { createdAt: 'asc' }, take: limit * 3,
      select: { leadId: true, createdAt: true },
    });
    const ids = [...new Set(rows.map((r) => r.leadId))];
    if (!ids.length) return out;
    const leads = await prisma.lead.findMany({ where: { ...baseLeadWhere(rule), id: { in: ids }, stage: t.stage }, select: leadSelect });
    for (const lead of leads) { if (out.length >= limit) break; await push(lead); } // eslint-disable-line no-await-in-loop
    return out;
  }

  if (t.type === 'dsp_phase_changed') {
    // dspPhaseChangedAt is stamped only when importStudents sees the phase
    // actually move (never on initial import, never on unrelated updates),
    // so a roster re-import can't masquerade as 280 phase changes.
    const leads = await prisma.lead.findMany({
      where: { ...baseLeadWhere(rule), dspPhase: t.phase, dspPhaseChangedAt: { gte: floor, lte: cutoff } },
      orderBy: { dspPhaseChangedAt: 'asc' }, take: limit * 2, select: leadSelect,
    });
    for (const lead of leads) { if (out.length >= limit) break; await push(lead); } // eslint-disable-line no-await-in-loop
    return out;
  }

  if (t.type === 'no_reply' || t.type === 'no_activity') {
    // Conversation went quiet: lastMessageAt is older than the delay but not
    // older than the lookback. no_reply additionally requires that the last
    // message was OURS (the lead left us on read).
    const leads = await prisma.lead.findMany({
      where: {
        ...baseLeadWhere(rule, { excludeWon: true }),
        conversations: { some: {
          aiEnabled: true, status: { notIn: [...UNTOUCHABLE_CONV, 'CLOSED'] },
          lastMessageAt: { gte: floor, lte: cutoff },
        } },
      },
      orderBy: { updatedAt: 'asc' }, take: limit * 3, select: leadSelect,
    });
    for (const lead of leads) {
      if (out.length >= limit) break;
      const conv = lead.conversations?.[0];
      if (!conv?.lastMessageAt || conv.lastMessageAt > cutoff || conv.lastMessageAt < floor) continue;
      if (t.type === 'no_reply') {
        const { last } = await conversationFacts(conv.id); // eslint-disable-line no-await-in-loop
        if (!last || last.direction !== 'OUTBOUND') continue;
      }
      await push(lead); // eslint-disable-line no-await-in-loop
    }
    return out;
  }

  if (t.type === 'mastery_event') {
    // Learning events from the AI Agent Mastery dashboard arrive as SYSTEM
    // activities (metadata.masteryEvent, see webhooks/mastery.webhook.js).
    // Optional trigger.badge / trigger.module narrow the match. Enrolled
    // students' conversations are usually CLOSED with AI off, so this branch
    // deliberately does NOT require an AI-enabled conversation — any
    // conversation with a phone is enough to send a nudge.
    const meta = { path: ['masteryEvent'], equals: t.event };
    const acts = await prisma.activity.findMany({
      where: { tenantId: rule.tenantId, type: 'SYSTEM', metadata: meta, createdAt: { gte: floor, lte: cutoff } },
      orderBy: { createdAt: 'asc' }, take: limit * 3, select: { leadId: true, metadata: true },
    });
    const ids = [...new Set(acts
      .filter((a) => (!t.badge || a.metadata?.badge === t.badge) && (!t.module || a.metadata?.module === t.module))
      .map((a) => a.leadId).filter(Boolean))];
    if (!ids.length) return out;
    const leads = await prisma.lead.findMany({ where: { ...baseLeadWhere(rule), id: { in: ids } }, select: leadSelect });
    for (const lead of leads) {
      if (out.length >= limit) break;
      const conv = lead.conversations?.[0];
      if (!conv) continue;
      const facts = await conversationFacts(conv.id); // eslint-disable-line no-await-in-loop
      const insideWindow = !!facts.lastInboundAt && (now - facts.lastInboundAt) < WA_WINDOW_MS;
      out.push({ lead, conversationId: conv.id, insideWindow, facts });
    }
    return out;
  }

  logger.warn({ ruleId: rule.id, type: t.type }, 'Automation rule has unknown trigger type');
  return out;
};

// Enrolment row upsert: create on the first touch, update on later ones.
// Never throws — a bookkeeping failure must not take the tick down.
const recordRun = (rule, leadId, status, reason, extra = {}) => prisma.automationRun.upsert({
  where: { ruleId_leadId: { ruleId: rule.id, leadId } },
  create: { tenantId: rule.tenantId, ruleId: rule.id, leadId, status, reason: reason || null, ...extra },
  update: { status, reason: reason || null, ...extra },
}).catch((err) => logger.warn({ err, ruleId: rule.id, leadId }, 'Could not record automation run'));

// Deliver ONE touch of the rule to one lead. `stepIndex` 0 is the enrolment
// touch; later indexes are sequence follow-ups. Writes the enrolment row.
const sendTouch = async (tenant, rule, { lead, conversationId, insideWindow }, stepIndex = 0, now = new Date()) => {
  const steps = normalizeSteps(rule.action);
  const step = steps[stepIndex] || steps[0];
  const phone = lead.contact?.phone;
  if (!phone) return recordRun(rule, lead.id, 'SKIPPED', 'no_phone', { step: stepIndex, nextDueAt: null });

  // Outside Meta's 24h customer-service window only an approved template
  // delivers. If the step names one (waTemplate), use it; otherwise
  // record the skip so the admin can see exactly why nothing went out.
  const tpl = step.waTemplate;
  const useTemplate = !insideWindow && tpl?.name;
  if (!insideWindow && !useTemplate) return recordRun(rule, lead.id, 'SKIPPED', 'outside_24h_window', { step: stepIndex, nextDueAt: null });

  const content = renderTemplate(step.template, lead);
  const label = steps.length > 1 ? ` (touch ${stepIndex + 1}/${steps.length})` : '';
  let waMessageId = null;
  let sendError = null;
  try {
    if (useTemplate) {
      // Body params map 1:1 to {{1}}, {{2}}… in the approved template.
      // Default is a single {{1}} = first name, matching the DSP templates.
      const params = (tpl.bodyParams?.length ? tpl.bodyParams : ['{name}'])
        .map((p) => ({ type: 'text', text: renderTemplate(p, lead) }));
      waMessageId = await whatsappService.sendTemplate(
        tenant, phone, tpl.name, tpl.language || 'en',
        [{ type: 'body', parameters: params }]
      );
    } else {
      waMessageId = await whatsappService.sendText(tenant, phone, content);
    }
  } catch (err) {
    sendError = err?.response?.data?.error?.message || err?.message || 'send_failed';
  }

  if (!waMessageId) {
    await prisma.activity.create({
      data: {
        tenantId: rule.tenantId, leadId: lead.id, type: 'SYSTEM',
        content: `⚠️ Automation "${rule.name}"${label} could not send WhatsApp message`,
        metadata: { flag: 'automation_send_failed', ruleId: rule.id, step: stepIndex, error: sendError },
      },
    }).catch(() => {});
    return recordRun(rule, lead.id, 'FAILED', sendError || 'wa_send_failed', { step: stepIndex, nextDueAt: null });
  }

  await prisma.message.create({
    data: {
      tenantId: rule.tenantId, conversationId, waMessageId,
      direction: 'OUTBOUND', sender: 'SYSTEM', type: useTemplate ? 'TEMPLATE' : 'TEXT', content, status: 'SENT',
    },
  }).catch((err) => logger.warn({ err }, 'Automation: could not persist outbound message'));
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } }).catch(() => {});
  await prisma.activity.create({
    data: {
      tenantId: rule.tenantId, leadId: lead.id, type: 'SYSTEM',
      content: `🤖 Automation "${rule.name}"${label} sent WhatsApp ${useTemplate ? `template ${tpl.name}` : 'message'}`,
      metadata: { ruleId: rule.id, step: stepIndex, preview: content.slice(0, 120) },
    },
  }).catch(() => {});
  const plan = planAfterTouch(steps, stepIndex, now);
  return recordRun(rule, lead.id, plan.status, useTemplate ? `template:${tpl.name}` : null, { step: plan.step, nextDueAt: plan.nextDueAt, lastTouchAt: plan.lastTouchAt });
};

// Kept for callers that think in "matches" (enrolment touch).
const executeMatch = (tenant, rule, match) => sendTouch(tenant, rule, match, 0);

// ── Sequence advance ─────────────────────────────────────────────────
// Leads enrolled in this rule whose next touch is due. Re-checks eligibility
// and the reply/agent cancel rules right before sending — the inbound worker
// cancels eagerly, but a tick can race a webhook, so this is the backstop.
const advanceDue = async (tenant, rule, { limit = MAX_SENDS_PER_RULE_PER_TICK, now = new Date() } = {}) => {
  const steps = normalizeSteps(rule.action);
  const results = [];
  if (steps.length < 2 || limit <= 0) return results;

  const due = await prisma.automationRun.findMany({
    where: { ruleId: rule.id, status: 'ACTIVE', nextDueAt: { lte: now } },
    orderBy: { nextDueAt: 'asc' }, take: limit,
    select: { id: true, leadId: true, step: true, lastTouchAt: true },
  });
  for (const run of due) {
    const stepIndex = run.step; // touches sent so far == index of the next one
    if (!steps[stepIndex]) { // nothing left — close the row out
      await prisma.automationRun.update({ where: { id: run.id }, data: { status: 'SENT', nextDueAt: null } }).catch(() => {}); // eslint-disable-line no-await-in-loop
      continue;
    }
    const lead = await prisma.lead.findFirst({ where: { id: run.leadId, tenantId: rule.tenantId }, select: leadSelect }); // eslint-disable-line no-await-in-loop
    const conv = lead?.conversations?.[0];
    const facts = conv ? await conversationFacts(conv.id) : null; // eslint-disable-line no-await-in-loop
    const reason = cancelReasonFor({ lead, conv, facts, since: run.lastTouchAt, excludeWon: isChaseTrigger(rule) });
    if (reason) {
      await prisma.automationRun.update({ where: { id: run.id }, data: { status: 'CANCELLED', cancelReason: reason, nextDueAt: null } }).catch(() => {}); // eslint-disable-line no-await-in-loop
      results.push({ leadId: run.leadId, status: 'CANCELLED', reason });
      continue;
    }
    const insideWindow = !!facts.lastInboundAt && (now - facts.lastInboundAt) < WA_WINDOW_MS;
    const out = await sendTouch(tenant, rule, { lead, conversationId: conv.id, insideWindow }, stepIndex, now); // eslint-disable-line no-await-in-loop
    results.push({ leadId: run.leadId, status: out?.status || 'FAILED' });
  }
  return results;
};

// Called by the inbound worker the moment a lead writes to us (and by
// takeover / payment-proof paths): every pending touch for that lead stops.
// Runs inside the caller's request context, so RLS scoping is inherited.
const cancelSequencesForLead = async (leadId, reason = CANCEL_REASONS.replied) => {
  if (!leadId) return 0;
  try {
    const { count } = await prisma.automationRun.updateMany({
      where: { leadId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelReason: reason, nextDueAt: null },
    });
    if (count) logger.info({ leadId, count, reason }, '🤖 Automation sequence cancelled');
    return count;
  } catch (err) {
    logger.warn({ err, leadId }, 'Could not cancel automation sequences');
    return 0;
  }
};

// Evaluate + execute every enabled rule for ONE tenant. Runs inside that
// tenant's RLS context.
const runTenant = async (tenantId) => requestContext.run({ requestId: `automation:${tenantId}`, tenantId }, async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { tenantId, skipped: 'tenant_not_found' };
  const rules = await prisma.automationRule.findMany({ where: { tenantId, enabled: true } });
  const summary = { tenantId, rules: rules.length, sent: 0, failed: 0, skipped: 0, cancelled: 0 };
  const tally = (status) => {
    if (status === 'SENT' || status === 'ACTIVE') summary.sent += 1;
    else if (status === 'FAILED') summary.failed += 1;
    else if (status === 'CANCELLED') summary.cancelled += 1;
    else summary.skipped += 1;
  };

  for (const rule of rules) {
    // 1. Due follow-up touches first, so a fresh blast can't starve them.
    let budget = MAX_SENDS_PER_RULE_PER_TICK;
    try {
      const advanced = await advanceDue(tenant, rule, { limit: budget }); // eslint-disable-line no-await-in-loop
      advanced.forEach((r) => tally(r.status));
      budget -= advanced.filter((r) => r.status !== 'CANCELLED').length;
    } catch (err) {
      logger.error({ err, ruleId: rule.id, tenantId }, 'Automation: advanceDue failed');
    }

    // 2. New enrolments.
    let matches = [];
    try {
      matches = await findMatches(rule, { limit: budget }); // eslint-disable-line no-await-in-loop
    } catch (err) {
      logger.error({ err, ruleId: rule.id, tenantId }, 'Automation: findMatches failed');
      continue;
    }
    for (const m of matches) {
      // Sequential on purpose — keeps us under WhatsApp send rate limits.
      const run = await sendTouch(tenant, rule, m, 0); // eslint-disable-line no-await-in-loop
      tally(run?.status);
    }
    if (matches.length) logger.info({ tenantId, ruleId: rule.id, rule: rule.name, matches: matches.length }, '🤖 Automation rule evaluated');
  }
  return summary;
});

// Cross-tenant tick. Only tenants that have at least one enabled rule are
// visited, so the 30-odd tenants with everything paused cost one query.
const runTick = async () => runWithSystemScope(async () => {
  const tenants = await prisma.automationRule.findMany({
    where: { enabled: true }, distinct: ['tenantId'], select: { tenantId: true },
  });
  const results = [];
  for (const { tenantId } of tenants) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runTenant(tenantId).catch((err) => {
      logger.error({ err, tenantId }, 'Automation tick failed for tenant');
      return { tenantId, error: err.message };
    }));
  }
  const totals = results.reduce((a, r) => ({
    sent: a.sent + (r.sent || 0), failed: a.failed + (r.failed || 0), skipped: a.skipped + (r.skipped || 0), cancelled: a.cancelled + (r.cancelled || 0),
  }), { sent: 0, failed: 0, skipped: 0, cancelled: 0 });
  if (tenants.length) logger.info({ tenants: tenants.length, ...totals }, '🤖 Automation tick finished');
  return { tenants: tenants.length, ...totals };
});

module.exports = {
  findMatches, runTenant, runTick, renderTemplate, baseLeadWhere, TICK_MINUTES,
  executeMatch, sendTouch, advanceDue, cancelSequencesForLead,
  // pure — see automation.steps.js (unit tested without a DB)
  normalizeSteps, validateSteps, planAfterTouch, cancelReasonFor, isChaseTrigger, CANCEL_REASONS, UNIT_MS,
};
