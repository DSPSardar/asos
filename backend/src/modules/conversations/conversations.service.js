// src/modules/conversations/conversations.service.js

const prisma = require('../../config/database');
const whatsappService = require('../../services/whatsapp.service');
const claudeService = require('../../services/claude.service');
const logger = require('../../utils/logger');

const listConversations = async ({ tenantId, status, page = 1, limit = 20 }) => {
  const where = { tenantId, ...(status && { status }) };
  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: { select: { name: true, phone: true, waProfilePic: true } },
        lead:    { select: { stage: true, scoreLabel: true, aiScore: true } },
        messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { content: true, sender: true, sentAt: true, status: true } },
      },
    }),
    prisma.conversation.count({ where }),
  ]);
  return { conversations, total };
};

const listByClient = async ({ tenantId, clientId }) => prisma.conversation.findMany({
  where: { tenantId, contactId: clientId },
  orderBy: { lastMessageAt: 'desc' },
});

const getConversation = async (tenantId, conversationId) => {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      contact: true,
      lead: {
        include: {
          campaign: { select: { name: true } },
          agent:    { select: { fullName: true, email: true } },
        },
      },
      messages: { orderBy: { sentAt: 'asc' } },
    },
  });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, expose: true });
  return conv;
};

const sendMessage = async (tenantId, conversationId, userId, content) => {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { contact: true, lead: true },
  });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, expose: true });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

  let waMessageId = null;
  try {
    waMessageId = await whatsappService.sendText(tenant, conv.contact.phone, content);
  } catch (err) {
    logger.error({ err }, 'Failed to send manual agent message via WA');
  }

  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId,
      waMessageId,
      direction: 'OUTBOUND',
      sender: 'AGENT',
      type: 'TEXT',
      content,
      status: waMessageId ? 'SENT' : 'FAILED',
    },
  });

  await prisma.activity.create({
    data: {
      tenantId,
      leadId: conv.leadId,
      userId,
      type: 'NOTE',
      content: `Agent sent message: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`,
      metadata: { messageId: message.id },
    },
  });

  return message;
};

const toggleAI = async (tenantId, conversationId, aiEnabled) => {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, expose: true });

  return prisma.conversation.update({
    where: { id: conversationId },
    data: { aiEnabled, status: aiEnabled ? 'AI_HANDLING' : conv.status },
  });
};

const takeover = async (tenantId, conversationId, userId) => {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { lead: true },
  });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, expose: true });

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'HUMAN_TAKEOVER', aiEnabled: false, handoffReason: 'Manual agent takeover' },
  });

  await prisma.activity.create({
    data: {
      tenantId,
      leadId: conv.leadId,
      userId,
      type: 'AI_ACTION',
      content: 'Agent took over conversation from AI',
      metadata: { action: 'takeover' },
    },
  });

  return updated;
};

const handback = async (tenantId, conversationId, userId) => {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { lead: true },
  });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, expose: true });

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'AI_HANDLING', aiEnabled: true, handoffReason: null },
  });

  await prisma.activity.create({
    data: {
      tenantId,
      leadId: conv.leadId,
      userId,
      type: 'AI_ACTION',
      content: 'Conversation handed back to AI',
      metadata: { action: 'handback' },
    },
  });

  return updated;
};

const closeConversation = async (tenantId, conversationId, userId) => {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, expose: true });

  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'CLOSED', aiEnabled: false },
  });
};

const getSummary = async (tenantId, conversationId) => {
  const messages = await prisma.message.findMany({
    where: { conversationId, tenantId },
    orderBy: { sentAt: 'asc' },
    take: 30,
    select: { sender: true, content: true },
  });

  return claudeService.generateSummary({ tenantId, messageHistory: messages });
};

const getSuggestedReply = async (tenantId, conversationId) => {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { lead: true, contact: true },
  });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, expose: true });
  const messages = await prisma.message.findMany({
    where: { tenantId, conversationId },
    orderBy: { sentAt: 'asc' },
    take: 20,
    select: { sender: true, content: true },
  });
  const out = await claudeService.runCloser({
    aiConfig: await prisma.aiConfig.findUnique({ where: { tenantId } }),
    lead: conv.lead,
    contact: conv.contact,
    messageHistory: messages,
    newMessage: messages[messages.length - 1]?.content || 'Suggest next message',
    qualifierOutput: { lead_status: conv.lead.scoreLabel, score: Math.max(1, Math.round((conv.lead.aiScore || 10) / 10)), intent: conv.lead.intent || 'medium', problem_summary: conv.lead.problemSummary || '', next_action: conv.lead.nextAction || 'continue_qualifying' },
  });
  return { suggestion: out.reply_message };
};

module.exports = {
  listConversations, getConversation, sendMessage,
  toggleAI, takeover, handback, closeConversation, getSummary, getSuggestedReply, listByClient,
};
