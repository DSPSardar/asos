// src/modules/mcp/mcp.tools.js
//
// The read-only tools an AI assistant (ChatGPT / Dots, Claude, Gemini) can
// call through the ASOS connector. Every handler takes (tenantId, args) and
// reuses the SAME services the dashboard uses — the Today queue
// (needsYou.service), the one enrolled-student definition
// (enrollment.definition), leads + analytics — so an assistant can never
// report a number the dashboard disagrees with.
//
// Privacy (Phase 1, no 'pii' scope): customer phones are masked to the last
// 3 digits, emails / bank / payment fields are never returned, and free
// text (message bodies, summaries) is scrubbed of phone numbers, emails and
// long digit runs (account / card numbers) before it leaves.
'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const leadsService = require('../leads/leads.service');
const analyticsService = require('../analytics/analytics.service');
const needsYou = require('../../services/needsYou.service');
const { getEnrollmentSummary } = require('../../services/enrollment.definition');

const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

// ── Privacy helpers ────────────────────────────────────────────────────
const maskPhone = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 4 ? `•••${d.slice(-3)}` : null;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}\b/g;
// Any run of 7+ digits, allowing spaces / dashes / a leading + — phones,
// account numbers, card numbers, CNICs.
const LONG_DIGITS_RE = /\+?\d(?:[\s-]?\d){6,}/g;

const scrub = (text, max = 400) => {
  const t = String(text || '')
    .replace(EMAIL_RE, '[email]')
    .replace(IBAN_RE, '[account]')
    .replace(LONG_DIGITS_RE, '[number]')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// Customer display names come from WhatsApp profiles and are sometimes an
// email address or a phone number — scrub them like any other free text.
const cleanName = (name) => scrub(name, 60) || 'Unknown';

const dashboardLink = (conversationId) => (conversationId ? `${env.APP_URL}/conversations?id=${conversationId}` : null);
const num = (v) => (v == null ? 0 : Number(v) || 0);
const clampInt = (v, min, max, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

// Start of "today" and of "this week" (Monday) in Pakistan time, as UTC Dates.
const pktStarts = (now = new Date()) => {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const dayStart = new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()) - PKT_OFFSET_MS);
  const dow = (pkt.getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(dayStart.getTime() - dow * DAY_MS);
  return { dayStart, weekStart };
};

const periodRange = (period, now = new Date()) => {
  const { dayStart, weekStart } = pktStarts(now);
  switch (period) {
    case 'today': return { from: dayStart, to: now };
    case 'week':  return { from: weekStart, to: now };
    case '7d':    return { from: new Date(now - 7 * DAY_MS), to: now };
    case '30d':   return { from: new Date(now - 30 * DAY_MS), to: now };
    case '90d':   return { from: new Date(now - 90 * DAY_MS), to: now };
    default:      return { from: undefined, to: undefined }; // all-time
  }
};

const REASON_LABEL = {
  payment_proof: 'sent payment proof — waiting for your verification',
  student_message: 'enrolled student wrote — needs a human reply',
  handoff: 'handed to a human by the AI',
  ai_off: 'AI is switched off on this thread',
  no_reply_from_ai: 'customer wrote and nobody has replied',
  we_spoke_last: 'hot lead gone quiet — we spoke last',
};

const queueRow = (r) => ({
  name: cleanName(r.name),
  phone: maskPhone(r.phone),
  group: r.group,
  why: REASON_LABEL[r.reason] || r.reason,
  stage: r.stage,
  score: `${r.scoreLabel} ${r.aiScore}/100`,
  hours_waiting: r.hoursWaiting,
  their_last_words: scrub(r.summary, 200),
  can_reply_freely: !!r.insideWindow, // inside WhatsApp's 24h window
  conversation_id: r.conversationId,
  open_in_dashboard: dashboardLink(r.conversationId),
});

// ── Handlers ──────────────────────────────────────────────────────────

const todaySummary = async (tenantId, _args, now = new Date()) => {
  const { dayStart, weekStart } = pktStarts(now);
  const [newLeadsToday, today, week, allTime, queue, pendingProofs] = await Promise.all([
    prisma.lead.findMany({ where: { tenantId, createdAt: { gte: dayStart } }, select: { contactId: true }, distinct: ['contactId'] }),
    getEnrollmentSummary(tenantId, { from: dayStart, to: now }),
    getEnrollmentSummary(tenantId, { from: weekStart, to: now }),
    getEnrollmentSummary(tenantId, {}),
    needsYou.collectQueue(tenantId, { viewer: null, now }),
    prisma.conversation.count({ where: { tenantId, status: 'PENDING_VERIFICATION', lead: { stage: { not: 'CLOSED_WON' } } } }),
  ]);
  const currency = allTime.currency;
  return {
    date_pkt: new Date(dayStart.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10),
    new_leads_today: newLeadsToday.length,
    paid_today: { students: today.period.students, revenue: today.period.revenue, currency },
    paid_this_week: { students: week.period.students, revenue: week.period.revenue, currency },
    paid_all_time: { students: allTime.allTime.students, revenue: allTime.allTime.revenue, currency },
    needs_you: {
      needs_me: queue.totals?.needs_me || 0,
      unanswered: queue.totals?.unanswered || 0,
      quiet_hot_leads: queue.totals?.quiet || 0,
      stalled_hot_leads: queue.totals?.stalled || 0,
      payment_proofs_waiting: pendingProofs,
    },
    ai_handled_last_7_days: queue.context?.handledByAi || 0,
    note: 'Paid means payment received and recorded. Use needs_me for the names.',
  };
};

const needsMe = async (tenantId, args = {}, now = new Date()) => {
  const group = args.group && args.group !== 'all' ? args.group : null;
  const limit = clampInt(args.limit, 1, 50, 15);
  const queue = await needsYou.collectQueue(tenantId, { viewer: null, now });
  const rows = queue.rows.filter((r) => !group || r.group === group).slice(0, limit);
  return {
    showing: rows.length,
    totals: queue.totals,
    order: 'needs_me → unanswered → quiet → stalled; money waiting and open WhatsApp windows first',
    items: rows.map(queueRow),
  };
};

const hotLeads = async (tenantId, args = {}) => {
  const limit = clampInt(args.limit, 1, 50, 10);
  const leads = await leadsService.getHotLeads(tenantId, limit);
  return {
    showing: leads.length,
    items: leads.map((l) => {
      const conv = l.conversations?.[0];
      const said = conv?.messages?.[0];
      return {
        name: cleanName(l.contact?.name),
        phone: maskPhone(l.contact?.phone),
        stage: l.stage,
        score: `${l.scoreLabel} ${num(l.aiScore)}/100`,
        what_they_want: scrub(l.problemSummary, 200),
        their_last_words: scrub(said?.content, 200),
        last_message_at: conv?.lastMessageAt || null,
        assigned_to: l.agent?.fullName || null,
        conversation_id: conv?.id || null,
        open_in_dashboard: dashboardLink(conv?.id),
      };
    }),
  };
};

// Counts only — leadsService.getPipeline also loads every open lead with its
// contact, which an assistant never needs and which is slow on big tenants.
// Enrolled comes from the one shared definition, same as the dashboard.
const pipeline = async (tenantId) => {
  const [stats, enrollment] = await Promise.all([
    prisma.lead.groupBy({ by: ['stage'], where: { tenantId }, _count: { id: true }, _sum: { dealValue: true } }),
    getEnrollmentSummary(tenantId, {}),
  ]);
  const byStage = {};
  for (const s of stats) byStage[s.stage] = { leads: s._count?.id || 0, deal_value: num(s._sum?.dealValue) };
  return {
    stages: byStage,
    enrolled_students: enrollment.allTime.students,
    note: 'Lead rows per stage. CLOSED_WON counts deals; enrolled_students counts paid ones. For revenue use the revenue tool.',
  };
};

const revenue = async (tenantId, args = {}, now = new Date()) => {
  const period = args.period || 'all';
  const { from, to } = periodRange(period, now);
  const s = await getEnrollmentSummary(tenantId, { from, to });
  return {
    period,
    from: from ? from.toISOString() : null,
    to: to ? to.toISOString() : null,
    students: period === 'all' ? s.allTime.students : s.period.students,
    revenue: period === 'all' ? s.allTime.revenue : s.period.revenue,
    currency: s.currency,
    all_time: s.allTime,
    rule: 'A student is a distinct person with a won lead that carries a recorded fee > 0, dated by when they paid.',
  };
};

const performance = async (tenantId, args = {}, now = new Date()) => {
  const days = clampInt(args.days, 1, 365, 30);
  const o = await analyticsService.getOverview(tenantId, { from: new Date(now - days * DAY_MS), to: now });
  return {
    days,
    leads: { people: o.leads.total, hot: o.leads.hot, lost: o.leads.closedLost },
    paid_students: o.leads.enrolled,
    revenue: o.revenue,
    conversion_rate: o.conversionRate,
    messages: { total: o.messages.total, sent_by_ai: o.messages.aiHandled, ai_share: o.messages.aiHandlingRate },
    ai_usage: { tokens_used: o.usage.aiTokensUsed, tokens_limit: o.usage.aiTokensLimit },
  };
};

const findLead = async (tenantId, args = {}) => {
  const q = String(args.query || '').trim();
  if (q.length < 2) return { error: 'Give at least 2 characters of a name, or the last 3+ digits of a phone.' };
  const digits = q.replace(/\D/g, '');
  const byPhone = digits.length >= 3 && digits.length === q.replace(/[\s+-]/g, '').length;
  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      contact: byPhone ? { phone: { endsWith: digits } } : { name: { contains: q, mode: 'insensitive' } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: {
      id: true, stage: true, scoreLabel: true, aiScore: true, product: true, problemSummary: true,
      dealValue: true, enrollmentFee: true, currency: true, closedAt: true, updatedAt: true,
      contact: { select: { name: true, phone: true } },
      conversations: { orderBy: { lastMessageAt: 'desc' }, take: 1, select: { id: true, status: true, aiEnabled: true, lastMessageAt: true } },
    },
  });
  return {
    showing: leads.length,
    items: leads.map((l) => {
      const conv = l.conversations?.[0];
      const fee = num(l.enrollmentFee) || num(l.dealValue);
      return {
        name: cleanName(l.contact?.name),
        phone: maskPhone(l.contact?.phone),
        stage: l.stage,
        paid: l.stage === 'CLOSED_WON' && fee > 0 ? { amount: fee, currency: l.currency || 'PKR', at: l.closedAt } : null,
        product: l.product || null,
        score: `${l.scoreLabel} ${num(l.aiScore)}/100`,
        what_they_want: scrub(l.problemSummary, 200),
        conversation_status: conv?.status || null,
        ai_on: conv ? conv.aiEnabled !== false : null,
        last_message_at: conv?.lastMessageAt || null,
        conversation_id: conv?.id || null,
        open_in_dashboard: dashboardLink(conv?.id),
      };
    }),
  };
};

const conversation = async (tenantId, args = {}) => {
  const id = String(args.conversation_id || '').trim();
  const take = clampInt(args.limit, 1, 30, 12);
  const conv = await prisma.conversation.findFirst({
    where: { id, tenantId },
    select: {
      id: true, status: true, aiEnabled: true, lastMessageAt: true,
      lead: { select: { stage: true, scoreLabel: true, aiScore: true, problemSummary: true, contact: { select: { name: true, phone: true } } } },
    },
  });
  if (!conv) return { error: 'No conversation with that id in this account. Use find_lead or needs_me to get one.' };
  const messages = (await prisma.message.findMany({
    where: { conversationId: id, tenantId },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take,
    select: { direction: true, sender: true, type: true, content: true, sentAt: true },
  })).reverse();
  return {
    name: cleanName(conv.lead?.contact?.name),
    phone: maskPhone(conv.lead?.contact?.phone),
    stage: conv.lead?.stage || null,
    score: conv.lead ? `${conv.lead.scoreLabel} ${num(conv.lead.aiScore)}/100` : null,
    what_they_want: scrub(conv.lead?.problemSummary, 200),
    status: conv.status,
    ai_on: conv.aiEnabled !== false,
    showing_last: messages.length,
    messages: messages.map((m) => ({
      from: m.direction === 'INBOUND' ? 'customer' : String(m.sender || 'agent').toLowerCase(),
      type: m.type,
      text: m.type === 'TEXT' || m.content ? scrub(m.content, 600) : `[${String(m.type).toLowerCase()}]`,
      at: m.sentAt,
    })),
    open_in_dashboard: dashboardLink(conv.id),
  };
};

const pendingPayments = async (tenantId, args = {}, now = new Date()) => {
  const limit = clampInt(args.limit, 1, 50, 20);
  const convs = await prisma.conversation.findMany({
    where: { tenantId, status: 'PENDING_VERIFICATION', lead: { stage: { not: 'CLOSED_WON' } } },
    orderBy: { paymentProofAt: 'asc' },
    take: limit,
    select: {
      id: true, paymentProofAt: true, lastMessageAt: true,
      lead: { select: { product: true, contact: { select: { name: true, phone: true } } } },
    },
  });
  return {
    showing: convs.length,
    note: 'Oldest first. Verify each one in the dashboard — the assistant cannot verify payments in this version.',
    items: convs.map((c) => {
      const since = c.paymentProofAt || c.lastMessageAt;
      return {
        name: cleanName(c.lead?.contact?.name),
        phone: maskPhone(c.lead?.contact?.phone),
        product: c.lead?.product || null,
        proof_sent_at: since,
        hours_waiting: since ? Math.floor((now - new Date(since)) / 3_600_000) : null,
        conversation_id: c.id,
        open_in_dashboard: dashboardLink(c.id),
      };
    }),
  };
};

// ── Registry ──────────────────────────────────────────────────────────
// `input` is a zod raw shape (what McpServer.registerTool expects).
// Descriptions are written for the assistant: when to call, what comes back.
const { z } = require('zod');

const TOOLS = [
  {
    name: 'today_summary',
    title: "Today's sales summary",
    description: "Start here. Today's new leads, payments received today / this week / all time, and how many conversations need the owner right now (payment proofs, handoffs, unanswered, quiet hot leads). Times are Pakistan time.",
    input: {},
    handler: todaySummary,
  },
  {
    name: 'needs_me',
    title: 'What needs me',
    description: "The owner's action queue, same as the dashboard's Today page: people waiting on a human (payment proofs, handoffs, enrolled students), messages nobody answered, hot leads gone quiet, and hot leads stalled in a stage. Sorted with money waiting first.",
    input: {
      group: z.enum(['all', 'needs_me', 'unanswered', 'quiet', 'stalled']).optional().describe('Filter to one group. Default: all.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max rows. Default 15.'),
    },
    handler: needsMe,
  },
  {
    name: 'hot_leads',
    title: 'Hot leads',
    description: 'Open leads the AI scored HOT, most recently active first, with what they want and their own last words.',
    input: { limit: z.number().int().min(1).max(50).optional().describe('Max rows. Default 10.') },
    handler: hotLeads,
  },
  {
    name: 'pipeline',
    title: 'Pipeline by stage',
    description: 'Lead counts and deal value per stage (NEW → QUALIFYING → DIAGNOSED → PROPOSED → CLOSED_WON / CLOSED_LOST) plus total paid students.',
    input: {},
    handler: pipeline,
  },
  {
    name: 'revenue',
    title: 'Revenue and paid students',
    description: 'Paid students and revenue for a period. Only payments actually received count.',
    input: { period: z.enum(['today', 'week', '7d', '30d', '90d', 'all']).optional().describe("'week' = since Monday (Pakistan time). Default: all.") },
    handler: revenue,
  },
  {
    name: 'performance',
    title: 'Sales performance',
    description: 'KPIs for the last N days: people who came in, hot leads, paid students, revenue, conversion rate, how much of the messaging the AI handled, and AI token usage.',
    input: { days: z.number().int().min(1).max(365).optional().describe('Look-back window in days. Default 30.') },
    handler: performance,
  },
  {
    name: 'find_lead',
    title: 'Find a lead',
    description: 'Look up a customer by name (partial is fine) or by the last 3+ digits of their phone. Returns stage, whether they paid, and the conversation id for the conversation tool.',
    input: { query: z.string().min(2).max(80).describe('Name, or the last digits of the phone number.') },
    handler: findLead,
  },
  {
    name: 'conversation',
    title: 'Read a conversation',
    description: 'The latest messages of one WhatsApp conversation (customer, AI and agent turns), oldest first. Phone numbers, emails and account numbers inside messages are redacted. Get the id from needs_me, hot_leads or find_lead.',
    input: {
      conversation_id: z.string().uuid().describe('Conversation id from another tool.'),
      limit: z.number().int().min(1).max(30).optional().describe('How many recent messages. Default 12.'),
    },
    handler: conversation,
  },
  {
    name: 'pending_payments',
    title: 'Payment proofs waiting',
    description: 'People who sent a payment screenshot that nobody has verified yet, oldest first. Verification itself happens in the dashboard.',
    input: { limit: z.number().int().min(1).max(50).optional().describe('Max rows. Default 20.') },
    handler: pendingPayments,
  },
];

module.exports = {
  TOOLS,
  // exported for tests
  maskPhone, scrub, cleanName, pktStarts, periodRange, queueRow,
  todaySummary, needsMe, hotLeads, pipeline, revenue, performance, findLead, conversation, pendingPayments,
};
