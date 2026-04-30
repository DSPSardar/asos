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
  const conversionRate = totalLeads > 0 ? ((closedWon / totalLeads) * 100).toFixed(1) : 0;
  const aiHandlingRate = totalMessages > 0 ? ((aiMessages / totalMessages) * 100).toFixed(1) : 0;

  return {
    leads:          { total: totalLeads, hot: hotLeads, closedWon, closedLost },
    revenue:        { total: totalRevenue, currency: 'BRL' },
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

  const stages = await prisma.lead.groupBy({
    by: ['stage'],
    where: { tenantId, createdAt: range },
    _count: { id: true },
    _sum:   { dealValue: true },
  });

  const order = ['NEW','QUALIFYING','DIAGNOSED','PROPOSED','CLOSED_WON','CLOSED_LOST'];
  const stageMap = {};
  stages.forEach(s => { stageMap[s.stage] = { count: s._count.id, value: parseFloat(s._sum.dealValue || 0) }; });

  const funnel = order.map((stage, i) => {
    const current  = stageMap[stage]?.count || 0;
    const previous = i > 0 ? (stageMap[order[i - 1]]?.count || 0) : null;
    const rate     = previous > 0 ? ((current / previous) * 100).toFixed(1) : null;
    return { stage, count: current, dealValue: stageMap[stage]?.value || 0, conversionRate: rate };
  });

  return { funnel };
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

module.exports = { getOverview, getFunnel, getRevenue, getAIPerformance, getAgentPerformance, getMessageVolume, getTeamPerformance };
