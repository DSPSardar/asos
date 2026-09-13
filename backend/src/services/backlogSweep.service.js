// src/services/backlogSweep.service.js
//
// Auto-clears the reply backlog and keeps it clear — no human sweep.
//
// A "backlog thread" is one where the lead wrote last and nothing has gone
// out since. The sweep answers those itself, EXCEPT threads whose last
// inbound is a refund / dispute / chargeback / legal / complaint or an
// explicit ask for Sardar or a human — those stay flagged for a person and
// raise ONE WhatsApp alert to the owner (never repeated for the same message).
//
//   one-off   : scripts/backlog-sweep.js  (--dry-run first)   → sweepTenant()
//   recurring : 'backlog-sweep' scheduler job every 15 min      → runTick()
//               replies after SILENT_MINUTES with no outbound; a thread a rule
//               handed to a human gets HUMAN_GRACE_HOURS before the AI answers.
//
// Reply by category (classifyThread is pure and unit-tested):
//   enrolled        CLOSED_WON + Mastery → fixed enrolled-student message, no pitch
//   payment_pending PROPOSED / details sent / proof received →
//                   proof received: the configured Payment Received message (form link);
//                   otherwise: Closer answer from the prompt + Knowledge Gaps, enrol link appended
//   sales           NEW / QUALIFYING / DIAGNOSED → normal Qualifier + Closer turn
//   outside the 24h window → the approved re-open template instead of text (logged)
//
// Every reply logs ev "backlog-sweep"; the run summary (counts by category,
// templates used, skipped threads with reason) is kept in Redis for the
// /today banner.

const prisma = require('../config/database');
const redis = require('../config/redis');
const env = require('../config/env');
const logger = require('../utils/logger');
const claudeService = require('./claude.service');
const whatsappService = require('./whatsapp.service');
const automationService = require('./automation.service');
const outbound = require('./outbound.service');
const escalation = require('./agent-guards/escalation');
const neverSilent = require('./agent-guards/never-silent');
const { isEnrolledStudent } = require('./agent-guards/enrolled-support');
const { isPaymentPending } = require('./agent-guards/form-submitted');
const { guardAiStageTransition, isMasteryGuardedTenant } = require('./agent-guards/won-guard');
const { sanitizeHistoryForAI } = require('../utils/aiHistory');
const { requestContext, runWithSystemScope } = require('../middleware/requestContext.middleware');

const EV = 'backlog-sweep';
const SILENT_MINUTES = 30;
const HUMAN_GRACE_HOURS = 2;
const LOOKBACK_DAYS = 30;
const CANDIDATE_CAP = 800;
const MAX_REPLIES_PER_RUN = 150;
const SUMMARY_KEY = (tenantId) => `backlog:sweep:last:${tenantId}`;
const ALERT_KEY = (conversationId, messageId) => `backlog:alerted:${conversationId}:${messageId}`;
const ENROL_URL = 'https://www.digitalservicesprogram.com/mastery/enrol';
const APP_URL = 'https://www.digitalservicesprogram.com/app';

const ENROLLED_BACKLOG_REPLY =
  'Aap ki registration process mein hai — sign-in details aap ko email aur WhatsApp par mil jayengi. 🎓 ' +
  `Agar aap ke paas already access hai to yahan sign in karein: ${APP_URL} ` +
  '(Your registration is in process; sign-in details arrive by email and WhatsApp. If you already have access, sign in at digitalservicesprogram.com/app.)';

const HUMAN_PENDING_REPLY =
  'Shukriya — aap ka message hum tak pohanch gaya hai. Hamari team jald aap se rabta karegi. 🙏';

// ── Pure classification ───────────────────────────────────────────────
/**
 * Decide what the sweep should do with one thread.
 * @param {object} p
 * @param {object} p.conversation  { status, aiEnabled, paymentDetailsSentAt, paymentProofDetected, lastMessageAt }
 * @param {object} p.lead          { stage, product, alreadyEnrolledAt }
 * @param {object|null} p.last     latest message { direction, content, sentAt }
 * @param {Date} p.now
 * @returns {{ action: 'skip'|'reply', reason: string, category?: string, flagged?: string, insideWindow?: boolean }}
 */
const classifyThread = ({ conversation, lead, last, now = new Date(), silentMinutes = SILENT_MINUTES, humanGraceHours = HUMAN_GRACE_HOURS }) => {
  if (!conversation || !lead) return { action: 'skip', reason: 'no_lead' };
  if (!last || last.direction !== 'INBOUND') return { action: 'skip', reason: 'we_spoke_last' };
  if (lead.stage === 'CLOSED_LOST') return { action: 'skip', reason: 'closed_lost' };

  const waitedMs = now.getTime() - new Date(last.sentAt).getTime();
  const hard = escalation.detectHardEscalation(last.content || '');
  if (hard.escalate) return { action: 'skip', reason: `flagged:${hard.kind}`, flagged: hard.kind };

  const humanHeld = conversation.aiEnabled === false || ['HUMAN_TAKEOVER', 'PENDING_VERIFICATION'].includes(conversation.status);
  if (humanHeld && waitedMs < humanGraceHours * 3_600_000) return { action: 'skip', reason: 'human_grace' };
  if (!humanHeld && waitedMs < silentMinutes * 60_000) return { action: 'skip', reason: 'too_recent' };

  const category = isEnrolledStudent(lead) ? 'enrolled'
    : isPaymentPending({ lead, conversation }) ? 'payment_pending'
      : 'sales';
  const insideWindow = neverSilent.isInsideWindow(last.sentAt, now);
  return { action: 'reply', reason: humanHeld ? 'human_grace_expired' : 'unanswered', category, insideWindow, humanHeld };
};

// ── Alerts for flagged threads (once per inbound message) ─────────────
const alertPhoneFor = (tenant) => (isMasteryGuardedTenant(tenant.id) ? escalation.SARDAR_WHATSAPP : tenant.settings?.adminPhone || null);

const alertOnce = async (tenant, { conversation, lead, last, flagged }, { dryRun }) => {
  const key = ALERT_KEY(conversation.id, last.id);
  const first = await redis.set(key, '1', 'EX', 30 * 24 * 3600, 'NX').catch(() => null);
  if (!first) return false;
  const to = alertPhoneFor(tenant);
  if (!to) return false;
  const name = lead.contact?.name || lead.contact?.phone || 'Unknown';
  const msg = `🙋 *Needs you personally* — ${name} (+${String(lead.contact?.phone || '').replace(/^\+/, '')})\n` +
    `Reason: ${flagged.replace(/_/g, ' ')}\n"${String(last.content || '').slice(0, 160)}"\n\n` +
    `${env.APP_URL}/conversations/${conversation.id}`;
  if (dryRun) { await redis.del(key).catch(() => {}); return true; }
  try { await whatsappService.sendText(tenant, to, msg); } catch (err) { logger.warn({ err, conversationId: conversation.id }, 'backlog-sweep: alert send failed'); }
  return true;
};

// ── One thread → one outbound ─────────────────────────────────────────
const pickReopenTemplate = async (tenant) => {
  const configured = neverSilent.reopenTemplateFor(tenant);
  if (configured) return configured;
  const today = require('../modules/today/today.service');
  const list = await today.listTemplates(tenant.id).catch(() => []);
  return list.find((t) => /no_reply_followup/i.test(t.name)) || list.find((t) => /reengage|re_engage|followup/i.test(t.name)) || list[0] || null;
};

const replyToThread = async (tenant, { conversation, lead, last, verdict }, { dryRun }) => {
  const tenantId = tenant.id;
  const phone = lead.contact?.phone;
  const base = { tenant, conversation, tenantId, phone };
  const result = { conversationId: conversation.id, leadId: lead.id, name: lead.contact?.name || null, category: verdict.category, mode: null, template: null, sent: false };
  if (!phone || /^email:/.test(phone)) return { ...result, skipped: 'no_phone' };

  // Release the thread back to AI handling (a human held it long enough).
  if (!dryRun && (conversation.aiEnabled === false || conversation.status !== 'AI_HANDLING')) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: true, status: 'AI_HANDLING', handoffReason: null } });
  }

  // Outside the 24h window only a template delivers.
  if (!verdict.insideWindow) {
    const tpl = await pickReopenTemplate(tenant);
    if (!tpl) return { ...result, mode: 'template', skipped: 'no_template' };
    result.mode = 'template';
    result.template = tpl.name;
    if (dryRun) return { ...result, sent: true, dryRun: true };
    const r = await outbound.sendAndSaveTemplate({ ...base, lead, tpl, sender: 'SYSTEM', rawResponse: { systemMessage: 'backlog_sweep_template', template: tpl.name } });
    return { ...result, sent: r.sent, reason: r.reason };
  }

  const send = async (content, extra = {}) => {
    if (dryRun) return { sent: true, reason: 'dry_run' };
    const r = await outbound.sendAndSaveReply({ ...base, content, tokensUsed: extra.tokensUsed || 0, rawResponse: extra.rawResponse || { systemMessage: 'backlog_sweep' } });
    return r;
  };

  if (verdict.category === 'enrolled') {
    result.mode = 'enrolled_fixed';
    const r = await send(ENROLLED_BACKLOG_REPLY);
    return { ...result, sent: r.sent, reason: r.reason };
  }

  if (verdict.category === 'payment_pending' && conversation.paymentProofDetected) {
    // A screenshot arrived: the configured Payment Received message carries the enrol-form link.
    const text = tenant.aiConfig?.paymentProofMessage?.trim()
      || `Shukriya! Payment mil gayi. Enrolment form yahan bharein: ${ENROL_URL}`;
    result.mode = 'payment_received_form_link';
    const r = await send(text);
    return { ...result, sent: r.sent, reason: r.reason };
  }

  // Sales / payment-pending without proof → a real AI turn on their last message.
  const history = (await prisma.message.findMany({
    where: { conversationId: conversation.id, tenantId },
    orderBy: { sentAt: 'asc' },
    select: { id: true, sender: true, content: true, sentAt: true, type: true, direction: true, sentiment: true },
  })).filter((m) => !(m.type === 'AUDIO' && m.direction === 'OUTBOUND'));
  const previousInbound = [...history].reverse().find((m) => m.sender === 'CONTACT' && m.id !== last.id);
  const contact = lead.contact;

  let ai;
  try {
    ai = await claudeService.processMessage({
      tenantId, lead, contact, conversation,
      newMessage: last.content || '[non-text message]',
      messageHistory: sanitizeHistoryForAI(history.filter((m) => m.id !== last.id), tenant.aiConfig?.paymentDetails),
      handedBackToAI: true,
      welcomeVoiceAlreadySent: !!(tenant.aiConfig?.welcomeVoiceEnabled && contact?.sentWelcomeVoice),
      lastInboundSentiment: previousInbound?.sentiment || null,
      leadLanguage: lead.language || null,
    });
  } catch (err) {
    logger.error({ ev: EV, err, conversationId: conversation.id }, 'backlog-sweep: AI turn failed');
    result.mode = 'ai_failed_fallback';
    const r = await send(neverSilent.FINAL_FALLBACK_REPLY);
    return { ...result, sent: r.sent, reason: r.reason };
  }

  if (ai.action === 'handoff') {
    // The AI itself wants a human (refund etc. surfaced only in context). Keep it flagged.
    result.mode = 'ai_handoff';
    if (!dryRun) {
      await outbound.handleHandoff(tenant, conversation, lead, ai.handoffReason || 'AI requested a human (backlog sweep)');
      const r = await send(ai.reply || HUMAN_PENDING_REPLY);
      return { ...result, sent: r.sent, reason: r.reason, handoffReason: ai.handoffReason };
    }
    return { ...result, sent: true, dryRun: true, handoffReason: ai.handoffReason };
  }

  let text = ai.reply || neverSilent.FINAL_FALLBACK_REPLY;
  if (verdict.category === 'payment_pending' && !/digitalservicesprogram\.com\/mastery\/enrol/i.test(text)) {
    text = `${text}\n\nEnrol form: ${ENROL_URL}`;
  }
  result.mode = ai.mode || 'ai_reply';
  const r = await send(text, { tokensUsed: ai.tokensUsed, rawResponse: { ...ai, systemMessage: 'backlog_sweep' } });

  if (!dryRun && !ai.mode) {
    const stage = guardAiStageTransition({ tenantId, leadId: lead.id, fromStage: lead.stage, toStage: ai.stage }).stage;
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        stage, scoreLabel: ai.leadStatus, aiScore: ai.aiScore ?? lead.aiScore,
        intent: ai.intent || null, problemSummary: ai.problemSummary || null, nextAction: ai.nextAction || null,
        leadTemperature: ai.leadStatus || 'WARM',
      },
    }).catch((err) => logger.warn({ err, leadId: lead.id }, 'backlog-sweep: lead update failed'));
    if (stage !== lead.stage) {
      await prisma.leadStageHistory.create({ data: { tenantId, leadId: lead.id, fromStage: lead.stage, toStage: stage, changedBy: null } }).catch(() => {});
    }
    if (ai.sendPaymentDetails) await outbound.sendPaymentInstructions({ ...base });
  }
  return { ...result, sent: r.sent, reason: r.reason };
};

// ── Tenant sweep ──────────────────────────────────────────────────────
const loadCandidates = async (tenantId, now) => {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  return prisma.conversation.findMany({
    where: { tenantId, lastMessageAt: { gte: since }, lead: { stage: { not: 'CLOSED_LOST' } } },
    orderBy: { lastMessageAt: 'asc' },
    take: CANDIDATE_CAP,
    select: {
      id: true, tenantId: true, leadId: true, contactId: true, status: true, aiEnabled: true, lastMessageAt: true,
      paymentDetailsSentAt: true, paymentProofDetected: true,
      lead: { select: { id: true, tenantId: true, stage: true, product: true, scoreLabel: true, aiScore: true, intent: true, problemSummary: true,
        nextAction: true, businessUnit: true, language: true, alreadyEnrolledAt: true, formSubmittedAt: true, qualificationData: true,
        contact: { select: { id: true, name: true, phone: true, optedOutAt: true, sentWelcomeVoice: true } } } },
      messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { id: true, direction: true, content: true, sentAt: true } },
    },
  });
};

const emptySummary = (tenantId, { dryRun, now }) => ({
  tenantId, ranAt: now.toISOString(), dryRun, candidates: 0,
  replied: { total: 0, enrolled: 0, payment_pending: 0, sales: 0 },
  templates: {}, skipped: {}, alerts: 0,
  replies: [], flagged: [], skippedThreads: [],
});

const sweepTenant = async (tenantId, { dryRun = false, now = new Date(), limit = MAX_REPLIES_PER_RUN, silentMinutes = SILENT_MINUTES, humanGraceHours = HUMAN_GRACE_HOURS } = {}) =>
  requestContext.run({ requestId: `backlog-sweep:${tenantId}`, tenantId }, async () => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { aiConfig: true } });
    const summary = emptySummary(tenantId, { dryRun, now });
    if (!tenant) return { ...summary, error: 'tenant_not_found' };

    const candidates = await loadCandidates(tenantId, now);
    summary.candidates = candidates.length;
    const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

    for (const conversation of candidates) {
      const lead = conversation.lead;
      const last = conversation.messages?.[0] || null;
      const verdict = classifyThread({ conversation, lead, last, now, silentMinutes, humanGraceHours });
      const label = { conversationId: conversation.id, leadId: lead?.id || null, name: lead?.contact?.name || null, stage: lead?.stage || null };

      if (verdict.action === 'skip') {
        if (verdict.flagged) {
          const alerted = await alertOnce(tenant, { conversation, lead, last, flagged: verdict.flagged }, { dryRun });
          if (alerted) summary.alerts += 1;
          summary.flagged.push({ ...label, reason: verdict.reason, alerted });
        }
        // Routine skips (we spoke last, too recent) are counted, not listed.
        bump(summary.skipped, verdict.reason);
        if (!['we_spoke_last', 'too_recent', 'human_grace', 'closed_lost'].includes(verdict.reason)) summary.skippedThreads.push({ ...label, reason: verdict.reason });
        continue;
      }

      if (summary.replied.total >= limit) { bump(summary.skipped, 'run_limit'); continue; }

      let out;
      try {
        out = await replyToThread(tenant, { conversation, lead, last, verdict }, { dryRun });
      } catch (err) {
        logger.error({ ev: EV, err, conversationId: conversation.id }, 'backlog-sweep: reply failed');
        out = { ...label, category: verdict.category, sent: false, reason: err.message };
      }
      if (out.skipped) {
        bump(summary.skipped, out.skipped);
        summary.skippedThreads.push({ ...label, reason: out.skipped, category: verdict.category });
        continue;
      }
      if (out.template) bump(summary.templates, out.template);
      summary.replied.total += 1;
      bump(summary.replied, verdict.category);
      summary.replies.push({ ...label, category: verdict.category, mode: out.mode, template: out.template || null, sent: out.sent, reason: out.reason || null, humanHeld: !!verdict.humanHeld });
      logger.info({ ev: EV, tenantId, conversationId: conversation.id, leadId: lead.id, category: verdict.category, mode: out.mode,
        template: out.template || null, sent: out.sent, dryRun, humanHeld: !!verdict.humanHeld, waitedSince: last?.sentAt }, 'backlog-sweep reply');

      if (!dryRun && out.sent) await automationService.cancelSequencesForLead(lead.id, 'backlog_sweep');
    }

    // Keep the list fields bounded for the banner.
    summary.replies = summary.replies.slice(0, 200);
    summary.skippedThreads = summary.skippedThreads.slice(0, 100);
    summary.flagged = summary.flagged.slice(0, 100);
    if (!dryRun) redis.set(SUMMARY_KEY(tenantId), JSON.stringify(summary), 'EX', 30 * 24 * 3600).catch(() => {});
    logger.info({ ev: EV, tenantId, dryRun, candidates: summary.candidates, replied: summary.replied, templates: summary.templates, skipped: summary.skipped, alerts: summary.alerts }, 'backlog-sweep finished');
    return summary;
  });

/** Tenants the recurring sweep covers: the Mastery tenant + any tenant with settings.backlogSweep === true. */
const sweepTenantIds = async () => {
  const ids = new Set();
  if (env.MASTERY_TENANT_ID) ids.add(env.MASTERY_TENANT_ID);
  const optIn = await prisma.tenant.findMany({ where: { settings: { path: ['backlogSweep'], equals: true } }, select: { id: true } }).catch(() => []);
  optIn.forEach((t) => ids.add(t.id));
  return [...ids];
};

const runTick = async () => runWithSystemScope(async () => {
  const ids = await sweepTenantIds();
  const results = [];
  for (const tenantId of ids) {
    results.push(await sweepTenant(tenantId).catch((err) => { logger.error({ ev: EV, err, tenantId }, 'backlog-sweep tick failed'); return { tenantId, error: err.message }; }));
  }
  return results;
});

const lastSummary = async (tenantId) => {
  try { const raw = await redis.get(SUMMARY_KEY(tenantId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
};

module.exports = {
  EV, SILENT_MINUTES, HUMAN_GRACE_HOURS, ENROLLED_BACKLOG_REPLY, ENROL_URL,
  classifyThread, sweepTenant, runTick, lastSummary, replyToThread, pickReopenTemplate,
};
