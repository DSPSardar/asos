// src/modules/conversations/conversations.service.js

const prisma = require('../../config/database');
const whatsappService = require('../../services/whatsapp.service');
const claudeService = require('../../services/claude.service');
const metaService = require('../../services/meta.service');
const logger = require('../../utils/logger');
const redis = require('../../config/redis');
const { publishInboundMessage } = require('../../queues/message.queue');
const { sanitizeHistoryForAI } = require('../../utils/aiHistory');
const { signMediaUrl } = require('../../utils/mediaToken');

// Stored mediaUrls are bare `/media/<id>` paths; the serving route now
// requires a signed, expiring link (see app.js), so sign them on the way
// out. Legacy `/uploads/...` paths pass through untouched.
const withSignedMediaUrls = (messages) => (messages || []).map((m) =>
  m.mediaUrl?.startsWith('/media/')
    ? { ...m, mediaUrl: signMediaUrl(m.mediaUrl.slice('/media/'.length)) }
    : m
);

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
  conv.messages = withSignedMediaUrls(conv.messages);
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
  // no AI reply after it, trigger the AI to respond immediately.
  //
  // This used to publish under a fabricated `requeue_<id>` message id, which
  // defeated every dedup layer we have: the queue's per-message jobId, the
  // worker's unique waMessageId, and the "already answered" check. Handing
  // back twice therefore answered the same message twice — the same reply,
  // sent again — and inserted a phantom copy of the lead's question into the
  // transcript. Publish the real message id with an explicit `replay` flag
  // instead, and let the worker decide whether it still needs answering: it
  // is the only place that sees the conversation state at execution time.
  try {
    const lastMsg = await prisma.message.findFirst({
      where: { conversationId, tenantId },
      orderBy: { sentAt: 'desc' },
      select: { direction: true, sender: true, content: true, waMessageId: true, sentAt: true },
    });

    if (lastMsg?.direction === 'INBOUND' && lastMsg?.sender === 'CONTACT' && lastMsg?.waMessageId) {
      const contact = await prisma.contact.findFirst({ where: { tenantId, conversations: { some: { id: conversationId } } } });
      await publishInboundMessage({
        tenantId,
        phone: contact?.phone || conv.lead?.contact?.phone || '',
        contactName: contact?.name || null,
        content: lastMsg.content || '',
        waMessageId: lastMsg.waMessageId,
        messageType: 'text',
        timestamp: Math.floor(new Date(lastMsg.sentAt).getTime() / 1000).toString(),
        replay: true,
      });
      logger.info({ conversationId, tenantId }, '♻️ Re-queued last unanswered message after handback to AI');
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

// Resolves the PENDING_VERIFICATION queue. The worker parks a conversation
// there when a payment screenshot arrives, but nothing could take it out again:
// takeover/handback/close all move the conversation on without ever marking the
// lead won, so a verified payment never reached CLOSED_WON and won revenue
// undercounted every real enrollment.
//
// Idempotency key is the lead's own stage — deriveStage() is monotonic and
// CLOSED_WON is terminal, so a double-click cannot double-count.
const confirmPayment = async (tenantId, conversationId, userId) => {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { lead: true, contact: true, tenant: true },
  });
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, expose: true });

  // Guard against confirming a payment nobody ever sent proof for — booking
  // revenue should not be one mis-click away on an unrelated thread.
  if (!conv.paymentProofDetected) {
    throw Object.assign(new Error('No payment proof has been received for this conversation'),
      { statusCode: 409, expose: true });
  }

  if (conv.lead?.stage === 'CLOSED_WON') return conv;

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const updatedConv = await tx.conversation.update({
      where: { id: conversationId },
      data: { status: 'CLOSED', aiEnabled: false, handoffReason: 'Payment verified — enrollment confirmed' },
    });
    await tx.lead.update({
      where: { id: conv.leadId },
      data: { stage: 'CLOSED_WON', closedAt: now },
    });
    // STAGE_CHANGE, not AI_ACTION: this is a lifecycle transition made by a
    // human, and analytics separates the two by type.
    await tx.activity.create({
      data: {
        tenantId,
        leadId: conv.leadId,
        userId,
        type: 'STAGE_CHANGE',
        content: '💳 Payment verified — enrollment confirmed',
        metadata: { action: 'payment_confirmed', from: conv.lead?.stage || null, to: 'CLOSED_WON' },
      },
    });
    return updatedConv;
  });

  // Purchase fires here rather than when the AI hears "yes": this is the first
  // point at which money has actually been verified, so it is the only honest
  // signal to hand Meta's optimiser.
  if (conv.tenant && conv.contact?.phone) {
    metaService.trackPurchase(conv.tenant, conv.contact.phone, conv.leadId, conv.lead?.dealValue, conv.lead?.currency)
      .catch(() => {});
  }

  logger.info({ conversationId, leadId: conv.leadId, tenantId }, '💳 Payment confirmed — lead marked CLOSED_WON');
  return updated;
};

const getSummary = async (tenantId, conversationId) => {
  const [messages, aiConfig] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId, tenantId },
      orderBy: { sentAt: 'asc' },
      take: 30,
      select: { sender: true, content: true },
    }),
    prisma.aiConfig.findUnique({ where: { tenantId }, select: { paymentDetails: true } }),
  ]);

  // Bank details must not reach the LLM — see utils/aiHistory.js.
  return claudeService.generateSummary({
    tenantId,
    messageHistory: sanitizeHistoryForAI(messages, aiConfig?.paymentDetails),
  });
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
  const aiConfig = await prisma.aiConfig.findUnique({ where: { tenantId } });
  // Bank details must not reach the LLM — see utils/aiHistory.js.
  const history = sanitizeHistoryForAI(messages, aiConfig?.paymentDetails);
  const out = await claudeService.runCloser({
    aiConfig,
    lead: conv.lead,
    contact: conv.contact,
    messageHistory: history,
    newMessage: history[history.length - 1]?.content || 'Suggest next message',
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

  await prisma.$transaction(async (tx) => {
    await tx.message.deleteMany({ where: { conversationId } });
    await tx.aiAgentLog.deleteMany({ where: { conversationId } });
    await tx.conversation.delete({ where: { id: conversationId } });
  });
  return { deleted: true };
};

module.exports = {
  listConversations, getConversation, sendMessage,
  toggleAI, takeover, handback, closeConversation, confirmPayment, getSummary, getSuggestedReply, listByClient,
  clearMessages, deleteConversation,
};
