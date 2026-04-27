// src/workers/conversation.worker.js
// BullMQ worker — processes every inbound WhatsApp message
// Orchestrates: CRM resolution → Claude AI → WA reply → Meta attribution

require('dotenv').config();
const { Worker } = require('bullmq');
const redis = require('../config/redis');
const prisma = require('../config/database');
const claudeService = require('../services/claude.service');
const whatsappService = require('../services/whatsapp.service');
const metaService = require('../services/meta.service');
const logger = require('../utils/logger');
const { publishStatusUpdate } = require('../queues/message.queue');
const { QUEUE_NAMES } = require('../queues/message.queue');

// ─────────────────────────────────────────────────────────────────────
// MAIN JOB PROCESSOR
// ─────────────────────────────────────────────────────────────────────

const processInboundMessage = async (job) => {
  const { tenantId, phone, contactName, content, waMessageId, messageType,
          referral, mediaId, timestamp } = job.data;

  logger.info({ jobId: job.id, tenantId, phone, waMessageId }, '▶ Processing inbound message');

  // ── 1. Load tenant (with WA credentials) ─────────────────────────
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { aiConfig: true },
  });

  if (!tenant || tenant.status === 'SUSPENDED') {
    logger.warn({ tenantId }, 'Tenant not found or suspended — skipping');
    return;
  }

  if (!tenant.waPhoneId) {
    logger.warn({ tenantId }, 'No WA phone configured — skipping');
    return;
  }

  // ── 2. Mark message as read (async, non-blocking) ─────────────────
  whatsappService.markAsRead(tenant, waMessageId).catch(() => {});

  // ── 3. Resolve or create Contact ─────────────────────────────────
  const normalizedPhone = whatsappService.normalizePhone(phone);

  let contact = await prisma.contact.findUnique({
    where: { tenantId_phone: { tenantId, phone: normalizedPhone } },
  });

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        tenantId,
        phone: normalizedPhone,
        name: contactName || null,
        optIn: true,
      },
    });
    logger.info({ contactId: contact.id, phone: normalizedPhone }, 'New contact created');
  } else if (contactName && !contact.name) {
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: { name: contactName },
    });
  }

  // ── 4. Resolve or create Lead ─────────────────────────────────────
  let lead = await prisma.lead.findFirst({
    where: {
      tenantId,
      contactId: contact.id,
      stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  const isNewLead = !lead;

  if (!lead) {
    // Extract Meta Ads attribution from WA referral (Click-to-WA)
    const adAttribution = extractAdAttribution(referral);

    lead = await prisma.lead.create({
      data: {
        tenantId,
        contactId: contact.id,
        stage: 'NEW',
        scoreLabel: 'COLD',
        aiScore: 0,
        ...adAttribution,
      },
    });

    // Create ads tracking record
    if (adAttribution.metaCampaignId || adAttribution.metaAdId) {
      await prisma.adsTracking.create({
        data: {
          tenantId,
          leadId: lead.id,
          metaCampaignId: adAttribution.metaCampaignId,
          metaAdsetId: adAttribution.metaAdsetId,
          metaAdId: adAttribution.metaAdId,
          eventsSent: [],
        },
      }).catch(() => {});
    }

    // Fire Meta "Lead" event for new leads
    metaService.trackLead(tenant, normalizedPhone, lead.id).catch(() => {});
    metaService.trackContactInitiated(tenant, normalizedPhone, lead.id).catch(() => {});

    logger.info({ leadId: lead.id, contactId: contact.id }, 'New lead created');
  }

  // ── 5. Resolve or create Conversation ────────────────────────────
  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId,
      leadId: lead.id,
      status: { notIn: ['CLOSED'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId,
        leadId: lead.id,
        contactId: contact.id,
        status: 'AI_HANDLING',
        aiEnabled: true,
        lastMessageAt: new Date(),
      },
    });
  } else {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  }

  // ── 6. Persist inbound message to DB ─────────────────────────────
  await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      waMessageId,
      direction: 'INBOUND',
      sender: 'CONTACT',
      type: messageType?.toUpperCase() || 'TEXT',
      content: content || null,
      status: 'DELIVERED',
      sentAt: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    },
  });

  // ── 7. Check if AI is enabled for this conversation ───────────────
  const freshConv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  if (!freshConv?.aiEnabled || freshConv.status === 'HUMAN_TAKEOVER') {
    logger.info({ conversationId: conversation.id }, 'AI disabled — message delivered to agent inbox only');
    return;
  }

  // ── 8. Load message history for context ──────────────────────────
  const messageHistory = await prisma.message.findMany({
    where: { conversationId: conversation.id, tenantId },
    orderBy: { sentAt: 'asc' },
    take: 30,
    select: { sender: true, content: true, sentAt: true },
  });

  // ── 9. Call Claude AI Engine ──────────────────────────────────────
  let aiResult;
  try {
    aiResult = await claudeService.processMessage({
      tenantId,
      lead,
      contact,
      conversation,
      newMessage: content || '[non-text message]',
      messageHistory: messageHistory.slice(0, -1), // exclude current message
    });
  } catch (aiErr) {
    logger.error({ aiErr, leadId: lead.id }, 'Claude processing failed — handing off to agent');
    await handleHandoff(tenant, conversation, lead, 'AI service error — automatic handoff');
    return;
  }

  // ── 10. Update CRM with AI results (v1.5 — Qualifier + Closer outputs) ──
  const prevStage = lead.stage;

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      stage: aiResult.stage,
      scoreLabel: aiResult.leadStatus,
      aiScore: aiResult.aiScore ?? Math.round((aiResult.score || 1) * 10),
      // v1.5 columns
      intent:                 aiResult.intent || null,
      problemSummary:         aiResult.problemSummary || null,
      nextAction:             aiResult.nextAction || null,
      humanFollowupRequired:  !!aiResult.humanFollowupRequired,
      qualificationData: {
        ...lead.qualificationData,
        ...aiResult.qualificationData,
        lastDiagnosis:      aiResult.problemDiagnosis,
        lastFix:            aiResult.salesFix,
        lastUrgencyTrigger: aiResult.urgencyTrigger,
        updatedAt:          new Date().toISOString(),
      },
    },
  });

  // Log stage change activity
  if (prevStage !== aiResult.stage) {
    await prisma.activity.create({
      data: {
        tenantId,
        leadId: lead.id,
        type: 'STAGE_CHANGE',
        content: `AI moved lead from ${prevStage} → ${aiResult.stage}`,
        metadata: { fromStage: prevStage, toStage: aiResult.stage, aiScore: aiResult.score },
      },
    });
  }

  // Log AI action activity
  await prisma.activity.create({
    data: {
      tenantId,
      leadId: lead.id,
      type: 'AI_ACTION',
      content: `Qualifier: ${aiResult.score}/10 ${aiResult.leadStatus} · intent=${aiResult.intent || 'n/a'} · ${aiResult.action}`,
      metadata: {
        score: aiResult.score,
        aiScore: aiResult.aiScore,
        leadStatus: aiResult.leadStatus,
        intent: aiResult.intent,
        action: aiResult.action,
        problemSummary: aiResult.problemSummary,
        nextAction: aiResult.nextAction,
        urgencyTrigger: aiResult.urgencyTrigger,
        closerType: aiResult.closerOutput?.closing_type || null,
        humanFollowupRequired: aiResult.humanFollowupRequired,
        qualifierTokens: aiResult.qualifierTokens,
        closerTokens: aiResult.closerTokens,
        tokensUsed: aiResult.tokensUsed,
      },
    },
  });

  // v1.5 — log a dedicated activity when human follow-up is required (HOT/score≥8)
  if (aiResult.humanFollowupRequired && !lead.humanFollowupRequired) {
    await prisma.activity.create({
      data: {
        tenantId,
        leadId: lead.id,
        type: 'AI_ACTION',
        content: `🔥 HOT lead — human follow-up required (score ${aiResult.score}/10)`,
        metadata: {
          flag: 'human_followup_required',
          score: aiResult.score,
          intent: aiResult.intent,
          problemSummary: aiResult.problemSummary,
        },
      },
    });
  }

  // ── 11. Route based on AI action ─────────────────────────────────

  if (aiResult.action === 'handoff') {
    // A) Human handoff
    await handleHandoff(tenant, conversation, lead, aiResult.handoffReason);

    // Send the AI reply first, then the handoff message
    if (aiResult.reply) {
      await sendAndSaveReply({ tenant, conversation, tenantId, phone: normalizedPhone,
        content: aiResult.reply, tokensUsed: aiResult.tokensUsed, rawResponse: aiResult });
    }
    return;
  }

  if (aiResult.action === 'close') {
    // B) Closing — update lead, fire Purchase event
    await prisma.lead.update({
      where: { id: lead.id },
      data: { stage: 'CLOSED_WON', closedAt: new Date() },
    });

    await prisma.activity.create({
      data: {
        tenantId,
        leadId: lead.id,
        type: 'STAGE_CHANGE',
        content: 'AI detected closing signal — lead marked as CLOSED_WON',
        metadata: { closedBy: 'AI', urgencyTrigger: aiResult.urgencyTrigger },
      },
    });

    metaService.trackPurchase(tenant, normalizedPhone, lead.id, lead.dealValue, lead.currency).catch(() => {});
  }

  if (aiResult.stage === 'DIAGNOSED' && prevStage !== 'DIAGNOSED') {
    // Fire qualified event to Meta
    metaService.trackQualified(tenant, normalizedPhone, lead.id).catch(() => {});
  }

  // C) Continue — send AI reply
  await sendAndSaveReply({
    tenant, conversation, tenantId,
    phone: normalizedPhone,
    content: aiResult.reply,
    tokensUsed: aiResult.tokensUsed,
    rawResponse: aiResult,
  });

  logger.info({ leadId: lead.id, action: aiResult.action, stage: aiResult.stage }, '✅ Message processed');
};

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

const sendAndSaveReply = async ({ tenant, conversation, tenantId, phone, content, tokensUsed, rawResponse }) => {
  let waMessageId = null;

  try {
    waMessageId = await whatsappService.sendText(tenant, phone, content);
  } catch (err) {
    logger.error({ err, tenantId, phone }, 'Failed to send WA reply');
  }

  await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      waMessageId,
      direction: 'OUTBOUND',
      sender: 'AI',
      type: 'TEXT',
      content,
      status: waMessageId ? 'SENT' : 'FAILED',
      aiTokensUsed: tokensUsed || 0,
      aiRawResponse: rawResponse,
    },
  });
};

const handleHandoff = async (tenant, conversation, lead, reason) => {
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      status: 'HUMAN_TAKEOVER',
      aiEnabled: false,
      handoffReason: reason || 'Manual handoff',
    },
  });

  await prisma.activity.create({
    data: {
      tenantId: tenant.id,
      leadId: lead.id,
      type: 'AI_ACTION',
      content: `Conversation handed off to human agent. Reason: ${reason}`,
      metadata: { handoffReason: reason },
    },
  });

  logger.info({ leadId: lead.id, reason }, '🙋 Lead handed off to human agent');
};

const extractAdAttribution = (referral) => {
  if (!referral) return {};
  return {
    metaCampaignId: referral.ads_campaign_id || null,
    metaAdsetId:    referral.ads_adset_id || null,
    metaAdId:       referral.ads_ad_id || null,
    sourceUtm: {
      source:   referral.source_type || 'meta_ad',
      medium:   'whatsapp',
      campaign: referral.headline || null,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────
// STATUS UPDATE PROCESSOR
// ─────────────────────────────────────────────────────────────────────

const processStatusUpdate = async (job) => {
  const { waMessageId, status } = job.data;

  const statusMap = {
    SENT: 'SENT', DELIVERED: 'DELIVERED', READ: 'READ', FAILED: 'FAILED',
  };

  const mappedStatus = statusMap[status.toUpperCase()] || 'SENT';

  await prisma.message.updateMany({
    where: { waMessageId },
    data: {
      status: mappedStatus,
      ...(mappedStatus === 'DELIVERED' && { deliveredAt: new Date() }),
      ...(mappedStatus === 'READ'      && { readAt: new Date() }),
    },
  });
};

// ─────────────────────────────────────────────────────────────────────
// WORKER INITIALIZATION
// ─────────────────────────────────────────────────────────────────────

const worker = new Worker(
  QUEUE_NAMES.MESSAGE_QUEUE,
  async (job) => {
    if (job.name === 'inbound-message') return processInboundMessage(job);
    if (job.name === 'status-update')   return processStatusUpdate(job);
  },
  {
    connection: redis,
    concurrency: 10,         // Process up to 10 messages simultaneously
    limiter: { max: 50, duration: 1000 }, // Max 50 jobs/second
  }
);

worker.on('completed', (job) => {
  logger.debug({ jobId: job.id, name: job.name }, 'Job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, name: job?.name, err: err.message, attempts: job?.attemptsMade }, 'Job failed');
});

worker.on('error', (err) => {
  logger.error({ err }, 'Worker error');
});

logger.info('🔄 Conversation worker started');

module.exports = worker;
