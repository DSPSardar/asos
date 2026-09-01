// src/modules/today/today.service.js
// Today's Queue — the approval inbox behind /today. Selection is delegated
// to services/needsYou.service.js (shared with the daily digest); this file
// owns what the page does with a row: draft a reply, send it, send an
// approved template, skip it until tomorrow.
//
// Cost rule (tenant token budgets: FREE 100K, PRO 5M): an AI draft or
// summary is generated for ONE conversation at a time, only when asked, and
// cached in Redis keyed on the conversation's latest message id — so
// re-opening the page or expanding a row twice costs nothing, and a cached
// draft is invalidated exactly when the thread moves.
//
// NOTHING here sends without an explicit request from a signed-in user, and
// free-form text is refused outside Meta's 24h window (error 131047) so the
// page can never fire a send that is guaranteed to fail.
const prisma = require('../../config/database');
const redis = require('../../config/redis');
const logger = require('../../utils/logger');
const needsYou = require('../../services/needsYou.service');
const conversationsService = require('../conversations/conversations.service');
const whatsappService = require('../../services/whatsapp.service');
const automationService = require('../../services/automation.service');
const { normalizeSteps } = require('../../services/automation.steps');

const DRAFT_TTL_S = 24 * 60 * 60;
const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

const notFound = () => Object.assign(new Error('Conversation not found'), { statusCode: 404, expose: true });
const conflict = (msg) => Object.assign(new Error(msg), { statusCode: 409, expose: true });

const getQueue = (tenantId, viewer, { includeSnoozed = false } = {}) => needsYou.collectQueue(tenantId, { viewer, includeSnoozed });

// Latest message id + last inbound time, the two facts every action needs.
const threadFacts = async (tenantId, conversationId) => {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true, leadId: true, status: true, aiEnabled: true, lead: { select: { id: true, assignedTo: true, stage: true, contact: { select: { name: true, phone: true } } } } },
  });
  if (!conv) throw notFound();
  const [latest, lastInbound] = await Promise.all([
    prisma.message.findFirst({ where: { conversationId, tenantId }, orderBy: { sentAt: 'desc' }, select: { id: true, sentAt: true } }),
    prisma.message.findFirst({ where: { conversationId, tenantId, direction: 'INBOUND' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
  ]);
  const lastInboundAt = lastInbound?.sentAt || null;
  return { conv, latestMessageId: latest?.id || 'none', lastInboundAt, insideWindow: !!lastInboundAt && (Date.now() - new Date(lastInboundAt)) < WA_WINDOW_MS };
};

// AGENT may only act on leads assigned to them or unassigned — same
// visibility rule the queue applies.
const assertVisible = (conv, viewer) => {
  if (!viewer || viewer.role !== 'AGENT') return;
  const owner = conv.lead?.assignedTo;
  if (owner && owner !== viewer.userId) throw Object.assign(new Error('This lead is assigned to another agent'), { statusCode: 403, expose: true });
};

const cacheKey = (kind, tenantId, conversationId, messageId) => `today:${kind}:${tenantId}:${conversationId}:${messageId}`;

const cached = async (key, produce, { force = false } = {}) => {
  if (!force) {
    try {
      const hit = await redis.get(key);
      if (hit) return { ...JSON.parse(hit), cached: true };
    } catch (err) { logger.warn({ err }, 'Today: cache read failed'); }
  }
  const value = { ...(await produce()), generatedAt: new Date().toISOString() };
  redis.set(key, JSON.stringify(value), 'EX', DRAFT_TTL_S).catch(() => {});
  return { ...value, cached: false };
};

// One AI call per (conversation, latest message), ever.
const getDraft = async (tenantId, conversationId, viewer, { force = false } = {}) => {
  const facts = await threadFacts(tenantId, conversationId);
  assertVisible(facts.conv, viewer);
  const key = cacheKey('draft', tenantId, conversationId, facts.latestMessageId);
  const out = await cached(key, async () => {
    const { suggestion } = await conversationsService.getSuggestedReply(tenantId, conversationId);
    return { draft: suggestion || '' };
  }, { force });
  return { ...out, insideWindow: facts.insideWindow, lastInboundAt: facts.lastInboundAt };
};

const getSummary = async (tenantId, conversationId, viewer, { force = false } = {}) => {
  const facts = await threadFacts(tenantId, conversationId);
  assertVisible(facts.conv, viewer);
  const key = cacheKey('summary', tenantId, conversationId, facts.latestMessageId);
  return cached(key, async () => ({ summary: await conversationsService.getSummary(tenantId, conversationId) }), { force });
};

// Last few messages for the expanded row — enough context to judge the
// draft without opening the thread. Never the whole history.
const getContext = async (tenantId, conversationId, viewer, take = 6) => {
  const facts = await threadFacts(tenantId, conversationId);
  assertVisible(facts.conv, viewer);
  const messages = (await prisma.message.findMany({
    where: { conversationId, tenantId },
    orderBy: { sentAt: 'desc' }, take,
    select: { id: true, direction: true, sender: true, type: true, content: true, sentAt: true, status: true },
  })).reverse();
  return { messages, insideWindow: facts.insideWindow, lastInboundAt: facts.lastInboundAt, status: facts.conv.status, aiEnabled: facts.conv.aiEnabled };
};

// Free-form text. Refused outside the 24h window — use sendTemplate.
const sendReply = async (tenantId, conversationId, viewer, content) => {
  const text = String(content || '').trim();
  if (!text) throw Object.assign(new Error('content is required'), { statusCode: 400, expose: true });
  const facts = await threadFacts(tenantId, conversationId);
  assertVisible(facts.conv, viewer);
  if (!facts.insideWindow) throw conflict('Outside the 24h window — free-form text will not deliver (Meta 131047). Send an approved template instead.');
  const message = await conversationsService.sendMessage(tenantId, conversationId, viewer.userId, text);
  if (message.status === 'FAILED') throw Object.assign(new Error('WhatsApp rejected the message — see the thread'), { statusCode: 502, expose: true });
  return { message };
};

// Approved templates this tenant can send by hand: every waTemplate its
// automation rules name (main action and sequence steps), plus any listed
// under tenant.settings.waTemplates. The rule's text is the transcript copy
// (the rules keep it in sync with the approved wording).
const listTemplates = async (tenantId) => {
  const [rules, tenant] = await Promise.all([
    prisma.automationRule.findMany({ where: { tenantId }, select: { name: true, action: true } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
  ]);
  const byName = new Map();
  for (const r of rules) {
    for (const s of normalizeSteps(r.action)) {
      if (s.waTemplate?.name && !byName.has(s.waTemplate.name)) {
        byName.set(s.waTemplate.name, { name: s.waTemplate.name, language: s.waTemplate.language || 'en', bodyParams: s.waTemplate.bodyParams || ['{name}'], text: s.template, source: r.name });
      }
    }
  }
  for (const t of (tenant?.settings?.waTemplates || [])) {
    if (t?.name && !byName.has(t.name)) byName.set(t.name, { name: t.name, language: t.language || 'en', bodyParams: t.bodyParams || ['{name}'], text: t.text || '', source: 'Settings' });
  }
  return [...byName.values()];
};

const sendTemplate = async (tenantId, conversationId, viewer, templateName) => {
  const facts = await threadFacts(tenantId, conversationId);
  assertVisible(facts.conv, viewer);
  const tpl = (await listTemplates(tenantId)).find((t) => t.name === templateName);
  if (!tpl) throw Object.assign(new Error('Unknown template — it must be one of the tenant\'s approved templates'), { statusCode: 422, expose: true });
  const lead = facts.conv.lead;
  const phone = lead?.contact?.phone;
  if (!phone) throw conflict('Lead has no phone number');

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const params = tpl.bodyParams.map((p) => ({ type: 'text', text: automationService.renderTemplate(p, lead) }));
  let waMessageId = null;
  let sendError = null;
  try {
    waMessageId = await whatsappService.sendTemplate(tenant, phone, tpl.name, tpl.language, [{ type: 'body', parameters: params }]);
  } catch (err) {
    sendError = err?.response?.data?.error?.message || err?.message || 'send_failed';
  }
  const content = automationService.renderTemplate(tpl.text, lead) || `[template ${tpl.name}]`;
  const message = await prisma.message.create({
    data: { tenantId, conversationId, waMessageId, direction: 'OUTBOUND', sender: 'AGENT', type: 'TEMPLATE', content, status: waMessageId ? 'SENT' : 'FAILED' },
  });
  if (waMessageId) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }).catch(() => {});
    await automationService.cancelSequencesForLead(lead.id, 'agent_active');
  }
  await prisma.activity.create({
    data: { tenantId, leadId: lead.id, userId: viewer.userId, type: 'NOTE', content: `Agent sent template ${tpl.name}${waMessageId ? '' : ' (FAILED)'}`, metadata: { messageId: message.id, template: tpl.name, error: sendError } },
  }).catch(() => {});
  if (!waMessageId) throw Object.assign(new Error(`WhatsApp rejected the template: ${sendError}`), { statusCode: 502, expose: true });
  return { message };
};

const skip = async (tenantId, conversationId, viewer) => {
  const facts = await threadFacts(tenantId, conversationId);
  assertVisible(facts.conv, viewer);
  return needsYou.snooze(tenantId, viewer.userId, conversationId);
};
const unskip = (tenantId, conversationId, viewer) => needsYou.unsnooze(tenantId, viewer.userId, conversationId);

// Dismiss: gone until the lead writes again (keyed on the latest message).
const dismiss = async (tenantId, conversationId, viewer) => {
  const facts = await threadFacts(tenantId, conversationId);
  assertVisible(facts.conv, viewer);
  await prisma.activity.create({
    data: { tenantId, leadId: facts.conv.leadId, userId: viewer.userId, type: 'NOTE', content: 'Dismissed from Today\'s Queue until they write again', metadata: { action: 'today_dismiss' } },
  }).catch(() => {});
  return needsYou.dismiss(tenantId, conversationId, facts.latestMessageId);
};
const undismiss = (tenantId, conversationId) => needsYou.undismiss(tenantId, conversationId);

module.exports = { getQueue, getDraft, getSummary, getContext, sendReply, sendTemplate, listTemplates, skip, unskip, dismiss, undismiss };
