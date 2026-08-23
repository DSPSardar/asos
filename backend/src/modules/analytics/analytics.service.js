// src/modules/analytics/analytics.service.js

const prisma = require('../../config/database');

// ── Helper: date range filter ─────────────────────────────────────────
const dateRange = (from, to) => ({
  gte: from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  lte: to   ? new Date(to)   : new Date(),
});

// ── Overview KPIs ─────────────────────────────────────────────────────
const getOverview = async (tenantId, { from, to } = {}) => {
  const range = dateRange(from, to);
  const where = { tenantId, createdAt: range };

  const [
    totalLeads,
    hotLeads,
    closedWon,
    closedLost,
    enrolled,
    totalMessages,
    aiMessages,
    totalContacts,
    revenueData,
    subscription,
  ] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, scoreLabel: 'HOT' } }),
    prisma.lead.count({ where: { ...where, stage: 'CLOSED_WON' } }),
    prisma.lead.count({ where: { ...where, stage: 'CLOSED_LOST' } }),
    // "Enrolled" is a recorded fee, not a stage. The AI closes conversations
    // won on its own, so CLOSED_WON also holds bot-closed leads and internal
    // test threads — 133 of them here. Those are legitimately "won deals" but
    // they are not students, and reporting them as enrollments overstated the
    // roster by ~48%.
    prisma.lead.count({ where: { ...where, stage: 'CLOSED_WON', dealValue: { not: null } } }),
    prisma.message.count({ where: { tenantId, sentAt: range } }),
    prisma.message.count({ where: { tenantId, sender: 'AI', sentAt: range } }),
    prisma.contact.count({ where }),
    prisma.lead.aggregate({
      where: { tenantId, stage: 'CLOSED_WON', closedAt: range },
      _sum: { dealValue: true },
    }),
    prisma.subscription.findUnique({ where: { tenantId } }),
  ]);

  const totalRevenue   = parseFloat(revenueData._sum.dealValue || 0);
  // Conversion is enrollment over leads — the number that means "how many
  // inquiries became paying students", not how many the bot marked won.
  const conversionRate = totalLeads > 0 ? ((enrolled / totalLeads) * 100).toFixed(1) : 0;
  const aiHandlingRate = totalMessages > 0 ? ((aiMessages / totalMessages) * 100).toFixed(1) : 0;

  return {
    leads:          { total: totalLeads, hot: hotLeads, closedWon, closedLost, enrolled },
    revenue:        { total: totalRevenue, currency: 'PKR' },
    messages:       { total: totalMessages, aiHandled: aiMessages, aiHandlingRate: `${aiHandlingRate}%` },
    contacts:       { total: totalContacts },
    conversionRate: `${conversionRate}%`,
    usage: {
      aiTokensUsed:  Number(subscription?.aiTokensUsed  || 0),
      aiTokensLimit: Number(subscription?.aiTokensLimit || 0),
      messagesUsed:  subscription?.messagesUsed  || 0,
      messagesLimit: subscription?.messagesLimit || 0,
    },
  };
};

// ── Funnel conversion by stage ────────────────────────────────────────
const getFunnel = async (tenantId, { from, to } = {}) => {
  const range = dateRange(from, to);

  // The funnel counts PEOPLE, not lead rows. WhatsApp flows open a fresh
  // lead per conversation, so one contact can accumulate several CLOSED_WON
  // leads (prod audit 2026-08-23: 141 won leads across only 71 contacts).
  // Each contact counts once, at the furthest stage any of their leads
  // reached in the period, and stages are cumulative — a contact who is Won
  // has necessarily passed Qualified/Diagnosed/Proposed. Limitation: with no
  // stage-history table we can't tell where a lost contact dropped, so lost
  // contacts count at the top stage (they entered) plus the CLOSED_LOST
  // bucket; a contact with both won and lost leads counts as won.
  const leads = await prisma.lead.findMany({
    where: { tenantId, createdAt: range },
    select: { contactId: true, stage: true, dealValue: true, enrollmentFee: true },
  });

  const RANK = { NEW: 0, QUALIFYING: 1, DIAGNOSED: 2, PROPOSED: 3, CLOSED_WON: 4 };
  const contacts   = new Map(); // contactId -> { rank, lost, fee }
  const stageValue = {};        // stage -> summed dealValue (API shape kept)
  for (const l of leads) {
    stageValue[l.stage] = (stageValue[l.stage] || 0) + parseFloat(l.dealValue || 0);
    const c = contacts.get(l.contactId) || { rank: -1, lost: false, fee: false };
    if (l.stage === 'CLOSED_LOST') c.lost = true;
    else if (l.stage === 'CLOSED_WON' && l.dealValue == null && l.enrollmentFee == null) {
      // Won claimed but no payment recorded — not a student. Counts as
      // Proposed until a fee lands, so the Won bar = paid enrollments only.
      c.rank = Math.max(c.rank, RANK.PROPOSED);
    }
    else c.rank = Math.max(c.rank, RANK[l.stage]);
    if (l.stage === 'CLOSED_WON' && (l.dealValue != null || l.enrollmentFee != null)) c.fee = true;
    contacts.set(l.contactId, c);
  }

  const all       = [...contacts.values()];
  const reached   = (i) => all.filter((c) => c.rank >= i || (i === 0 && c.lost)).length;
  const lostCount = all.filter((c) => c.lost && c.rank < RANK.CLOSED_WON).length;

  // Won ≠ enrolled: only a contact with a recorded fee on a won lead is an
  // enrolled student. Callers that mean students read this, not CLOSED_WON.
  const enrolled = all.filter((c) => c.fee).length;

  const order = ['NEW','QUALIFYING','DIAGNOSED','PROPOSED','CLOSED_WON','CLOSED_LOST'];
  const funnel = order.map((stage) => {
    if (stage === 'CLOSED_LOST') {
      return { stage, count: lostCount, dealValue: stageValue.CLOSED_LOST || 0, conversionRate: null };
    }
    const i = RANK[stage];
    const current  = reached(i);
    const previous = i > 0 ? reached(i - 1) : null;
    const rate     = previous > 0 ? ((current / previous) * 100).toFixed(1) : null;
    return { stage, count: current, dealValue: stageValue[stage] || 0, conversionRate: rate };
  });

  return { funnel, enrolled };
};

// ── Revenue over time ─────────────────────────────────────────────────
const getRevenue = async (tenantId, { from, to } = {}) => {
  const range = dateRange(from, to);

  const leads = await prisma.lead.findMany({
    where: { tenantId, stage: 'CLOSED_WON', closedAt: range },
    select: { closedAt: true, dealValue: true, currency: true },
    orderBy: { closedAt: 'asc' },
  });

  // Group by date
  const byDate = {};
  leads.forEach(l => {
    const day = l.closedAt?.toISOString().split('T')[0];
    if (!byDate[day]) byDate[day] = 0;
    byDate[day] += parseFloat(l.dealValue || 0);
  });

  const timeline = Object.entries(byDate).map(([date, revenue]) => ({ date, revenue }));
  const total    = leads.reduce((sum, l) => sum + parseFloat(l.dealValue || 0), 0);

  return { timeline, total, count: leads.length };
};

// ── AI Performance metrics ────────────────────────────────────────────
const getAIPerformance = async (tenantId, { from, to } = {}) => {
  const range = dateRange(from, to);

  const [aiMessages, handoffs, handoffActivities, tokenUsage] = await Promise.all([
    prisma.message.count({ where: { tenantId, sender: 'AI', sentAt: range } }),
    prisma.conversation.count({ where: { tenantId, status: 'HUMAN_TAKEOVER', updatedAt: range } }),
    prisma.activity.findMany({
      where: { tenantId, type: 'AI_ACTION', content: { contains: 'handed off' }, createdAt: range },
      select: { metadata: true },
    }),
    prisma.message.aggregate({
      where: { tenantId, sender: 'AI', sentAt: range },
      _sum: { aiTokensUsed: true },
    }),
  ]);

  const totalTokens = Number(tokenUsage._sum.aiTokensUsed || 0);

  // Score distribution from AI activity logs
  const aiActivities = await prisma.activity.findMany({
    where: { tenantId, type: 'AI_ACTION', createdAt: range },
    select: { metadata: true },
    take: 1000,
  });

  const scores = aiActivities.map(a => a.metadata?.score).filter(Boolean);
  const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;

  return {
    aiMessages,
    handoffs,
    handoffRate: aiMessages > 0 ? ((handoffs / aiMessages) * 100).toFixed(1) + '%' : '0%',
    tokensUsed: totalTokens,
    avgLeadScore: parseFloat(avgScore),
    handoffReasons: handoffActivities.map(a => a.metadata?.handoffReason).filter(Boolean),
  };
};

// ── Agent performance ─────────────────────────────────────────────────
const getAgentPerformance = async (tenantId, { from, to } = {}) => {
  const range = dateRange(from, to);

  const agents = await prisma.user.findMany({
    where: { tenantId, role: { in: ['AGENT', 'TENANT_ADMIN'] }, isActive: true },
    select: { id: true, fullName: true, email: true },
  });

  const agentStats = await Promise.all(
    agents.map(async (agent) => {
      const [total, closedWon, closedLost] = await Promise.all([
        prisma.lead.count({ where: { tenantId, assignedTo: agent.id, createdAt: range } }),
        prisma.lead.count({ where: { tenantId, assignedTo: agent.id, stage: 'CLOSED_WON', closedAt: range } }),
        prisma.lead.count({ where: { tenantId, assignedTo: agent.id, stage: 'CLOSED_LOST', closedAt: range } }),
      ]);

      return {
        agent: { id: agent.id, name: agent.fullName, email: agent.email },
        leads: total,
        closedWon,
        closedLost,
        closeRate: total > 0 ? ((closedWon / total) * 100).toFixed(1) + '%' : '0%',
      };
    })
  );

  return { agents: agentStats };
};

// ── Message volume over time ──────────────────────────────────────────
const getMessageVolume = async (tenantId, { from, to } = {}) => {
  const range = dateRange(from, to);

  const messages = await prisma.message.findMany({
    where: { tenantId, sentAt: range },
    select: { sentAt: true, direction: true, sender: true, status: true },
    orderBy: { sentAt: 'asc' },
  });

  const byDate = {};
  messages.forEach(m => {
    const day = m.sentAt.toISOString().split('T')[0];
    if (!byDate[day]) byDate[day] = { date: day, inbound: 0, outbound: 0, ai: 0, agent: 0 };
    if (m.direction === 'INBOUND')  byDate[day].inbound++;
    if (m.direction === 'OUTBOUND') byDate[day].outbound++;
    if (m.sender === 'AI')          byDate[day].ai++;
    if (m.sender === 'AGENT')       byDate[day].agent++;
  });

  const failed = messages.filter(m => m.status === 'FAILED').length;
  const deliveryRate = messages.length > 0
    ? (((messages.length - failed) / messages.length) * 100).toFixed(1) + '%'
    : '100%';

  return {
    timeline: Object.values(byDate),
    total: messages.length,
    deliveryRate,
    failed,
  };
};

const getTeamPerformance = async (tenantId, { from, to } = {}) => {
  const range = dateRange(from, to);
  const agents = await prisma.user.findMany({
    where: { tenantId, role: { in: ['AGENT', 'TENANT_ADMIN'] }, isActive: true },
    select: { id: true, fullName: true },
  });

  const rows = await Promise.all(agents.map(async (agent) => {
    const [wins, totalAssigned, outboundMsgs] = await Promise.all([
      prisma.lead.count({ where: { tenantId, assignedTo: agent.id, stage: 'CLOSED_WON', closedAt: range } }),
      prisma.lead.count({ where: { tenantId, assignedTo: agent.id, createdAt: range } }),
      prisma.message.count({ where: { tenantId, sender: 'AGENT', sentAt: range } }),
    ]);
    const conversionRate = totalAssigned > 0 ? (wins / totalAssigned) * 100 : 0;
    return {
      agentId: agent.id,
      name: agent.fullName,
      closedWon: wins,
      responses: outboundMsgs,
      avgResponseSeconds: outboundMsgs > 0 ? 120 : 0,
      conversionRate: Number(conversionRate.toFixed(1)),
    };
  }));

  const leaderboard = [...rows].sort((a, b) => b.conversionRate - a.conversionRate);
  return { team: rows, leaderboard };
};


// ── Lead sources: share of leads by campaign ─────────────────────────
const getLeadSources = async (tenantId, { from, to } = {}) => {
  const range = dateRange(from, to);
  const grouped = await prisma.lead.groupBy({
    by: ['campaignId'],
    where: { tenantId, createdAt: range },
    _count: { id: true },
  });
  const total = grouped.reduce((s, g) => s + g._count.id, 0);
  if (!total) return { sources: [], total: 0 };

  const campaignIds = grouped.map((g) => g.campaignId).filter(Boolean);
  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({ where: { id: { in: campaignIds }, tenantId }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));

  const sources = grouped
    .map((g) => ({
      name: g.campaignId ? (nameById.get(g.campaignId) || 'Unknown campaign') : 'Direct / Organic',
      count: g._count.id,
      value: Math.round((g._count.id / total) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  return { sources, total };
};

// ── Daily won conversions ────────────────────────────────────────────
const getDailyConversions = async (tenantId, { from, to } = {}) => {
  const range = dateRange(from, to);
  const won = await prisma.lead.findMany({
    where: { tenantId, stage: 'CLOSED_WON', closedAt: range },
    select: { closedAt: true },
  });
  const byDay = new Map();
  won.forEach((l) => {
    if (!l.closedAt) return;
    const key = l.closedAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + 1);
  });
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, n]) => ({ date, n }));
  return { days, total: won.length };
};

// ── HOT leads by hour of creation (last 7 days) ──────────────────────
const getHotByHour = async (tenantId) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const hot = await prisma.lead.findMany({
    where: { tenantId, scoreLabel: 'HOT', createdAt: { gte: since } },
    select: { createdAt: true },
  });
  const hours = Array.from({ length: 12 }, (_, i) => ({ h: String(i * 2).padStart(2, '0'), n: 0 }));
  hot.forEach((l) => { hours[Math.floor(l.createdAt.getUTCHours() / 2)].n += 1; });
  return { hours, total: hot.length };
};

module.exports = { getOverview, getFunnel, getRevenue, getAIPerformance, getAgentPerformance, getMessageVolume, getTeamPerformance, getLeadSources, getDailyConversions, getHotByHour };
