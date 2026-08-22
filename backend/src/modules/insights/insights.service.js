// src/modules/insights/insights.service.js
// Aggregations for the AI Insights page. All data comes from the Qualifier's
// per-message classification (messages.sentiment / messages.signal_type),
// written by the conversation worker since Aug 2026 — older messages are
// unclassified and simply don't appear here.

const prisma = require('../../config/database');

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SIGNAL_LABELS = {
  PRICING: 'fee inquiries', INSTALLMENT: 'installment questions',
  BATCH: 'batch-schedule asks', CAREER: 'career-outcome questions',
  PAYMENT: 'payment-confirmation issues', TRACK_RECORD: 'credential checks',
  CONSULTATION: 'consultation requests', CORPORATE: 'corporate inquiries',
  ENROLLMENT: 'ready-to-enroll messages', RISK: 'at-risk objections',
};

// ── Sentiment: last 7 days, % positive/neutral/negative per day ──────
const getSentimentTrend = async (tenantId) => {
  const since = new Date(Date.now() - 7 * DAY_MS);
  const rows = await prisma.message.findMany({
    where: { tenantId, direction: 'INBOUND', sentAt: { gte: since }, sentiment: { not: null } },
    select: { sentAt: true, sentiment: true },
  });

  // Bucket by calendar day, oldest first
  const buckets = new Map();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { day: DAYS[d.getDay()], positive: 0, neutral: 0, negative: 0 });
  }
  rows.forEach((r) => {
    const b = buckets.get(r.sentAt.toISOString().slice(0, 10));
    if (!b) return;
    if (r.sentiment === 'POSITIVE') b.positive += 1;
    else if (r.sentiment === 'NEGATIVE') b.negative += 1;
    else b.neutral += 1;
  });

  const trend = [...buckets.values()].map((b) => {
    const total = b.positive + b.neutral + b.negative;
    if (!total) return { day: b.day, positive: 0, neutral: 0, negative: 0 };
    return {
      day: b.day,
      positive: Math.round((b.positive / total) * 100),
      neutral:  Math.round((b.neutral  / total) * 100),
      negative: Math.round((b.negative / total) * 100),
    };
  });
  return { trend, sampleSize: rows.length };
};

// ── Signals: classified inbound messages, last 7 days ────────────────
const getSignals = async (tenantId, limit = 20) => {
  const since = new Date(Date.now() - 7 * DAY_MS);
  const msgs = await prisma.message.findMany({
    where: { tenantId, direction: 'INBOUND', sentAt: { gte: since }, signalType: { not: null } },
    orderBy: { sentAt: 'desc' },
    take: limit,
    select: {
      id: true, content: true, signalType: true, sentiment: true, sentAt: true,
      conversation: {
        select: {
          lead: {
            select: {
              id: true, aiScore: true, scoreLabel: true, stage: true,
              contact: { select: { name: true, phone: true } },
            },
          },
        },
      },
    },
  });
  return msgs.map((m) => ({
    id: m.id,
    signalType: m.signalType,
    sentiment: m.sentiment,
    snippet: (m.content || '').slice(0, 200),
    sentAt: m.sentAt,
    lead: m.conversation?.lead ? {
      id: m.conversation.lead.id,
      aiScore: m.conversation.lead.aiScore,
      scoreLabel: m.conversation.lead.scoreLabel,
      stage: m.conversation.lead.stage,
      name: m.conversation.lead.contact?.name || 'Unknown',
      phone: m.conversation.lead.contact?.phone || null,
    } : null,
  }));
};

// ── Digest: programmatic weekly bullets from real aggregates ─────────
const getDigest = async (tenantId) => {
  const now = Date.now();
  const weekAgo = new Date(now - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now - 14 * DAY_MS);
  const stalledCutoff = new Date(now - 2 * DAY_MS);

  const [thisWeek, lastWeek, negNow, hotCount, handoffCount, stalled, payment] = await Promise.all([
    prisma.message.count({ where: { tenantId, direction: 'INBOUND', sentAt: { gte: weekAgo }, signalType: { not: null } } }),
    prisma.message.count({ where: { tenantId, direction: 'INBOUND', sentAt: { gte: twoWeeksAgo, lt: weekAgo }, signalType: { not: null } } }),
    prisma.message.count({ where: { tenantId, direction: 'INBOUND', sentAt: { gte: weekAgo }, sentiment: 'NEGATIVE' } }),
    prisma.lead.count({ where: { tenantId, scoreLabel: 'HOT', stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } } }),
    prisma.conversation.count({ where: { tenantId, status: 'HUMAN_TAKEOVER' } }),
    prisma.conversation.count({
      where: {
        tenantId, status: { not: 'HUMAN_TAKEOVER' }, lastMessageAt: { lt: stalledCutoff },
        lead: { scoreLabel: { in: ['HOT', 'WARM'] }, stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } },
      },
    }),
    prisma.message.count({ where: { tenantId, direction: 'INBOUND', sentAt: { gte: weekAgo }, signalType: 'PAYMENT' } }),
  ]);

  // Top signal type this week
  const byType = await prisma.message.groupBy({
    by: ['signalType'],
    where: { tenantId, direction: 'INBOUND', sentAt: { gte: weekAgo }, signalType: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 1,
  });
  const top = byType[0] ? (SIGNAL_LABELS[byType[0].signalType] || byType[0].signalType.toLowerCase()) : null;

  const bullets = [];
  if (thisWeek > 0) {
    const wow = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;
    bullets.push(
      `${thisWeek} buying signal${thisWeek === 1 ? '' : 's'} detected this week` +
      (top ? ` — ${top} lead the inbound` : '') +
      (wow !== null ? ` (${wow >= 0 ? '+' : ''}${wow}% vs last week).` : '.')
    );
  }
  if (negNow > 0) bullets.push(`${negNow} inbound message${negNow === 1 ? '' : 's'} flagged negative sentiment — review for objections or complaints.`);
  bullets.push(`${hotCount} HOT lead${hotCount === 1 ? '' : 's'} active in the pipeline; ${handoffCount} conversation${handoffCount === 1 ? '' : 's'} in the handoff queue.`);
  if (stalled > 0) bullets.push(`${stalled} HOT/WARM conversation${stalled === 1 ? '' : 's'} stalled > 48h — consider a re-engagement nudge.`);
  if (payment > 0) bullets.push(`${payment} payment-related message${payment === 1 ? '' : 's'} this week — verify screenshots and confirmations promptly.`);

  return { bullets, generatedAt: new Date().toISOString(), classifiedThisWeek: thisWeek };
};

module.exports = { getSentimentTrend, getSignals, getDigest };
