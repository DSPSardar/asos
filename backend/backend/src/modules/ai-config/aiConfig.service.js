// src/modules/ai-config/aiConfig.service.js

const prisma = require('../../config/database');
const claudeService = require('../../services/claude.service');

const getConfig = async (tenantId) => {
  const config = await prisma.aiConfig.findUnique({ where: { tenantId } });
  if (!config) throw Object.assign(new Error('AI config not found'), { statusCode: 404, expose: true });
  return config;
};

const updateConfig = async (tenantId, data) => {
  const allowed = ['systemPrompt','qualificationCriteria','closingScript','handoffTriggers','language','model','temperature','maxTokens'];
  const update = {};
  allowed.forEach(k => { if (data[k] !== undefined) update[k] = data[k]; });

  return prisma.aiConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...update },
    update,
  });
};

// Sandbox test — run a message through AI without affecting real data
const testConfig = async (tenantId, testMessage) => {
  const config = await prisma.aiConfig.findUnique({ where: { tenantId } });
  if (!config) throw Object.assign(new Error('AI config not found'), { statusCode: 404, expose: true });

  // Create mock lead/contact for testing
  const mockLead    = { id: 'test-lead', stage: 'NEW', aiScore: 0, scoreLabel: 'COLD', qualificationData: {} };
  const mockContact = { name: 'Test User', phone: '5500000000000' };
  const mockConv    = { id: 'test-conv', aiEnabled: true, status: 'ACTIVE' };

  const result = await claudeService.processMessage({
    tenantId,
    lead: mockLead,
    contact: mockContact,
    conversation: mockConv,
    newMessage: testMessage || 'Olá, quero saber mais informações.',
    messageHistory: [],
  });

  return {
    reply:           result.reply,
    leadStatus:      result.leadStatus,
    score:           result.score,
    stage:           result.stage,
    problemDiagnosis:result.problemDiagnosis,
    salesFix:        result.salesFix,
    urgencyTrigger:  result.urgencyTrigger,
    action:          result.action,
    tokensUsed:      result.tokensUsed,
  };
};

const getUsage = async (tenantId) => {
  const sub = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!sub) return null;

  const tokenPct = Number(sub.aiTokensLimit) > 0
    ? ((Number(sub.aiTokensUsed) / Number(sub.aiTokensLimit)) * 100).toFixed(1)
    : 0;

  return {
    aiTokensUsed:  Number(sub.aiTokensUsed),
    aiTokensLimit: Number(sub.aiTokensLimit),
    usagePercent:  parseFloat(tokenPct),
    messagesUsed:  sub.messagesUsed,
    messagesLimit: sub.messagesLimit,
    plan:          sub.plan,
    periodEnd:     sub.currentPeriodEnd,
  };
};

module.exports = { getConfig, updateConfig, testConfig, getUsage };
