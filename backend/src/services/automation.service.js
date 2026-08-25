// src/services/automation.service.js
// The IF/THEN automation engine behind /automations.
//
// Runs as a repeatable 'automation-tick' job on the scheduler queue (every
// TICK_MINUTES). Each tick, for every tenant with at least one enabled rule:
//   1. findMatches(rule)  → leads whose trigger condition is satisfied
//   2. for each match     → send WhatsApp, persist OUTBOUND message + Activity,
//                           write an automation_runs row (SENT / FAILED / SKIPPED)
//
// Safety rails (all deliberate — a rule can reach every lead in a tenant):
//   - a rule fires at most ONCE per lead, ever (unique rule_id+lead_id)
//   - only events at/after rule.enabledAt count; enabling never replays history
//   - LOOKBACK caps how far back time-based triggers scan
//   - MAX_SENDS_PER_RULE_PER_TICK caps blast size; leftovers go next tick
//   - conversations in HUMAN_TAKEOVER / PENDING_VERIFICATION / aiEnabled=false
//     and CLOSED_LOST leads are never touched
//   - Meta only delivers free-form text inside the 24h customer-service
//     window. Outside it we record SKIPPED(outside_24h_window) instead of
//     burning a send that Meta will reject with error 131047.
const prisma = require('../config/database');
const logger = require('../utils/logger');
const whatsappService = require('./whatsapp.service');
const { requestContext, runWithSystemScope } = require('../middleware/requestContext.middleware');

const TICK_MINUTES = 10;
const LOOKBACK_DAYS = 14;
const MAX_SENDS_PER_RULE_PER_TICK = 50;
const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
const delayMs = (t) => (Number(t?.delay) || 0) * (UNIT_MS[t?.unit] || UNIT_MS.hours);

const UNTOUCHABLE_CONV = ['HUMAN_TAKEOVER', 'PENDING_VERIFICATION'];

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

// Latest message direction + last inbound time for the 24h-window check.
const conversationFacts = async (conversationId) => {
  const [last, lastInbound] = await Promise.all([
    prisma.message.findFirst({ where: { conversationId }, orderBy: { sentAt: 'desc' }, select: { direction: true, sentAt: true } }),
    prisma.message.findFirst({ where: { conversationId, direction: 'INBOUND' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
  ]);
  return { last, lastInboundAt: lastInbound?.sentAt || null };
};

// Common lead filter shared by every trigger type.
const baseLeadWhere = (rule) => {
  const where = { tenantId: rule.tenantId, stage: { not: 'CLOSED_LOST' } };
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
        ...baseLeadWhere(rule),
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

  logger.warn({ ruleId: rule.id, type: t.type }, 'Automation rule has unknown trigger type');
  return out;
};

const recordRun = (rule, leadId, status, reason) => prisma.automationRun.create({
  data: { tenantId: rule.tenantId, ruleId: rule.id, leadId, status, reason: reason || null },
}).catch((err) => logger.warn({ err, ruleId: rule.id, leadId }, 'Could not record automation run'));

const executeMatch = async (tenant, rule, match) => {
  const { lead, conversationId, insideWindow } = match;
  const phone = lead.contact?.phone;
  if (!phone) return recordRun(rule, lead.id, 'SKIPPED', 'no_phone');

  // Outside Meta's 24h customer-service window only an approved template
  // delivers. If the rule names one (action.waTemplate), use it; otherwise
  // record the skip so the admin can see exactly why nothing went out.
  const tpl = rule.action?.waTemplate;
  const useTemplate = !insideWindow && tpl?.name;
  if (!insideWindow && !useTemplate) return recordRun(rule, lead.id, 'SKIPPED', 'outside_24h_window');

  const content = renderTemplate(rule.action?.template, lead);
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
        content: `⚠️ Automation "${rule.name}" could not send WhatsApp message`,
        metadata: { flag: 'automation_send_failed', ruleId: rule.id, error: sendError },
      },
    }).catch(() => {});
    return recordRun(rule, lead.id, 'FAILED', sendError || 'wa_send_failed');
  }

  await prisma.message.create({
    data: {
      tenantId: rule.tenantId, conversationId, waMessageId,
      direction: 'OUTBOUND', sender: 'SYSTEM', type: useTemplate ? 'TEMPLATE' : 'TEXT', content, status: 'SENT',
    },
  }).catch((err) => logger.warn({ err }, 'Automation: could not persist outbound message'));
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }).catch(() => {});
  await prisma.activity.create({
    data: {
      tenantId: rule.tenantId, leadId: lead.id, type: 'SYSTEM',
      content: `🤖 Automation "${rule.name}" sent WhatsApp ${useTemplate ? `template ${tpl.name}` : 'message'}`,
      metadata: { ruleId: rule.id, preview: content.slice(0, 120) },
    },
  }).catch(() => {});
  return recordRun(rule, lead.id, 'SENT', useTemplate ? `template:${tpl.name}` : null);
};

// Evaluate + execute every enabled rule for ONE tenant. Runs inside that
// tenant's RLS context.
const runTenant = async (tenantId) => requestContext.run({ requestId: `automation:${tenantId}`, tenantId }, async () => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { tenantId, skipped: 'tenant_not_found' };
  const rules = await prisma.automationRule.findMany({ where: { tenantId, enabled: true } });
  const summary = { tenantId, rules: rules.length, sent: 0, failed: 0, skipped: 0 };

  for (const rule of rules) {
    let matches = [];
    try {
      matches = await findMatches(rule); // eslint-disable-line no-await-in-loop
    } catch (err) {
      logger.error({ err, ruleId: rule.id, tenantId }, 'Automation: findMatches failed');
      continue;
    }
    for (const m of matches) {
      // Sequential on purpose — keeps us under WhatsApp send rate limits.
      const run = await executeMatch(tenant, rule, m); // eslint-disable-line no-await-in-loop
      if (run?.status === 'SENT') summary.sent += 1;
      else if (run?.status === 'FAILED') summary.failed += 1;
      else summary.skipped += 1;
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
  const totals = results.reduce((a, r) => ({ sent: a.sent + (r.sent || 0), failed: a.failed + (r.failed || 0), skipped: a.skipped + (r.skipped || 0) }), { sent: 0, failed: 0, skipped: 0 });
  if (tenants.length) logger.info({ tenants: tenants.length, ...totals }, '🤖 Automation tick finished');
  return { tenants: tenants.length, ...totals };
});

module.exports = { findMatches, runTenant, runTick, renderTemplate, TICK_MINUTES };
