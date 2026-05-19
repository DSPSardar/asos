// src/modules/conversations/conversations.service.js

const prisma = require('../../config/database');
const whatsappService = require('../../services/whatsapp.service');
const claudeService = require('../../services/claude.service');
const logger = require('../../utils/logger');
const redis = require('../../config/redis');
const { publishInboundMessage } = require('../../queues/message.queue');

// Redis key: marks conversations where a human deliberately handed control back to AI.
// Persists until the next manual takeover. Prevents Claude from auto-handing off HOT leads.
const aiControlKey = (conversationId) => `asos:ai_control:${conversationId}`;

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

  // Clear the AI control flag — next handback will re-set it
  await redis.del(aiControlKey(conversationId)).catch(() => {});

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

  // Persist AI control flag in Redis — worker reads this to suppress auto-handoff
  // even for HOT leads. Cleared only when human takes over again.
  await redis.set(aiControlKey(conversationId), '1').catch(() => {});

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

  // ── Re-queue last unanswered message from contact ─────────────────
  // If the last message in the conversation is from the contact and has
  // no AI reply after it, trigger Claude to respond immediately.
  try {
    const lastMessages = await prisma.message.findMany({
      where: { conversationId, tenantId },
      orderBy: { sentAt: 'desc' },
      take: 2,
      select: { direction: true, sender: true, content: true, waMessageId: true, sentAt: true },
    });

    const lastMsg = lastMessages[0];
    const secondMsg = lastMessages[1];

    // Re-queue if last message is inbound (from contact) and not already replied to
    if (lastMsg?.direction === 'INBOUND' && lastMsg?.sender === 'CONTACT') {
      // Make sure there's no outbound reply already after it
      const hasReply = secondMsg?.direction === 'OUTBOUND';
      if (!hasReply) {
        const contact = await prisma.contact.findFirst({ where: { tenantId, conversations: { some: { id: conversationId } } } });
        await publishInboundMessage({
          tenantId,
          phone: contact?.phone || conv.lead?.contact?.phone || '',
          contactName: contact?.name || null,
          content: lastMsg.content || '',
          waMessageId: `requeue_${lastMsg.waMessageId || Date.now()}`,
          messageType: 'text',
          timestamp: Math.floor(new Date(lastMsg.sentAt).getTime() / 1000).toString(),
        });
        logger.info({ conversationId, tenantId }, '♻️ Re-queued last unanswered message after handback to AI');
      }
    }
  } catch (err) {
    logger.warn({ err, conversationId }, 'Failed to re-queue last message after handback — non-fatal');
  }

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

// ── Delete all messages in a conversation (clear history) ────────────
const clearMessages = async (tenantId, conversationId) => {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });

  const { count } = await prisma.message.deleteMany({ where: { conversationId } });
  return { cleared: count };
};

// ── Delete conversation + all its messages and AI logs ───────────────
const deleteConversation = async (tenantId, conversationId) => {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId } }),
    prisma.aiAgentLog.deleteMany({ where: { conversationId } }),
    prisma.conversation.delete({ where: { id: conversationId } }),
  ]);
  return { deleted: true };
};

module.exports = {
  listConversations, getConversation, sendMessage,
  toggleAI, takeover, handback, closeConversation, getSummary, getSuggestedReply, listByClient,
  clearMessages, deleteConversation,
};
