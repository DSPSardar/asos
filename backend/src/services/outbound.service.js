// src/services/outbound.service.js
//
// Everything that puts a message in front of a lead on behalf of the AI:
// the text reply (with duplicate suppression, send retries and the optional
// cloned-voice note), the verbatim payment block, an approved template for
// threads outside the 24h window, and the human handoff bookkeeping.
//
// Shared by the inbound worker (conversation.worker.js) and the backlog
// sweep (backlogSweep.service.js) so the two can never drift on how a reply
// is sent or recorded. Every sender returns { sent, reason, waMessageId } —
// callers use it for the never-silent guarantee.

const prisma = require('../config/database');
const whatsappService = require('./whatsapp.service');
const elevenlabsService = require('./elevenlabs.service');
const logger = require('../utils/logger');

// Two identical outbound texts this close together are never intentional —
// they mean something re-ran, or the Closer regenerated a reply the lead
// already has (common when a lead re-sends the same question). The guards
// upstream stop the known causes; this is the last line of defence, right at
// the boundary where the lead would actually receive the message.
const DUPLICATE_REPLY_WINDOW_MS = 5 * 60 * 1000;

const isRepeatOfLastReply = async ({ conversation, tenantId, content }) => {
  const lastOutbound = await prisma.message.findFirst({
    where: { conversationId: conversation.id, tenantId, direction: 'OUTBOUND', type: 'TEXT' },
    orderBy: { sentAt: 'desc' },
    select: { content: true, sentAt: true },
  });

  if (!lastOutbound?.content) return false;
  if (lastOutbound.content.trim() !== content.trim()) return false;

  return Date.now() - new Date(lastOutbound.sentAt).getTime() < DUPLICATE_REPLY_WINDOW_MS;
};

// Sends the configured bank/payment block verbatim and records WHEN it went
// out. That timestamp is what later lets an inbound image be read as payment
// proof — without it we'd have no way to tell a receipt from any other photo.
const sendPaymentInstructions = async ({ tenant, conversation, tenantId, phone }) => {
  const details = tenant.aiConfig?.paymentDetails?.trim();
  if (!details) {
    logger.warn({ tenantId, conversationId: conversation.id },
      '⚠️  Payment details requested but none configured — lead was told to pay with no account to pay into');
    return false;
  }

  await sendAndSaveReply({
    tenant, conversation, tenantId, phone,
    content: details,
    tokensUsed: 0,
    // Marker, not an AI response: lets tooling identify this row without
    // comparing content strings.
    rawResponse: { systemMessage: 'payment_details' },
    // Never read account numbers aloud through a third-party TTS service —
    // the text block is the deliverable here.
    voiceNote: false,
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { paymentDetailsSentAt: new Date() },
  });

  logger.info({ conversationId: conversation.id }, '🏦 Payment details sent from config');
  return true;
};

const sendAndSaveReply = async ({ tenant, conversation, tenantId, phone, content, tokensUsed, rawResponse, voiceNote = true }) => {
  let waMessageId = null;

  if (!content?.trim()) {
    logger.warn({ tenantId, conversationId: conversation.id }, 'Empty reply — nothing sent');
    return { sent: false, reason: 'empty', waMessageId: null };
  }

  if (await isRepeatOfLastReply({ conversation, tenantId, content })) {
    logger.warn({ tenantId, conversationId: conversation.id, preview: content.slice(0, 80) },
      '🚫 Suppressed duplicate reply — identical text already sent to this lead');
    return { sent: false, reason: 'duplicate', waMessageId: null };
  }

  // Meta's send API fails transiently (throttling, 5xx) often enough that a
  // single attempt silently dropping the reply is a real incident: the lead
  // reads silence and nobody is told. Retry briefly, and if it still fails,
  // leave a visible Activity so the dashboard shows the gap.
  const MAX_SEND_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS && !waMessageId; attempt++) {
    try {
      waMessageId = await whatsappService.sendText(tenant, phone, content);
    } catch (err) {
      logger.error({ err, tenantId, phone, attempt }, 'Failed to send WA reply');
      if (attempt < MAX_SEND_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }

  if (!waMessageId) {
    await prisma.activity.create({
      data: {
        tenantId,
        leadId: conversation.leadId,
        type: 'AI_ACTION',
        content: '⚠️ WhatsApp send failed after retries — the lead did NOT receive the last reply',
        metadata: { flag: 'wa_send_failed', attempts: MAX_SEND_ATTEMPTS },
      },
    }).catch(() => {});
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

  // ── Optional voice-note follow-up, in the owner's ElevenLabs cloned voice.
  // Best-effort and fully isolated: the text reply above has already been
  // sent and saved, so nothing here can affect it.
  //
  // Per-tenant opt-out: the ElevenLabs credentials are platform-global, so
  // without this gate every tenant's leads would hear the platform owner's
  // cloned voice at the owner's expense. settings.voiceNotesEnabled = false
  // turns it off for a tenant; default stays on so current behavior for the
  // owner's own tenant is unchanged.
  const tenantVoiceEnabled = tenant.settings?.voiceNotesEnabled !== false;
  if (voiceNote && tenantVoiceEnabled && elevenlabsService.isVoiceCloneConfigured()) {
    try {
      const tts = await elevenlabsService.textToSpeech(content);
      if (tts) {
        const audioMessageId = await whatsappService.sendAudio(tenant, phone, tts.buffer, tts.mimeType);

        await prisma.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            waMessageId: audioMessageId,
            direction: 'OUTBOUND',
            sender: 'AI',
            type: 'AUDIO',
            // Marker, not a second copy of the reply text: the duplicate
            // content used to appear twice in every AI-bound history and in
            // the dashboard thread.
            content: '[Voice note of the reply above]',
            status: audioMessageId ? 'SENT' : 'FAILED',
            aiTokensUsed: 0,
            aiRawResponse: null,
          },
        });
      }
    } catch (err) {
      logger.error({ err, tenantId, phone }, 'Voice-note follow-up failed (non-blocking)');
    }
  }

  return { sent: !!waMessageId, reason: waMessageId ? 'sent' : 'wa_send_failed', waMessageId };
};

// Approved Meta template, for threads outside the 24h customer-service
// window where free text is rejected (131047). Persists a TEMPLATE row so
// the transcript shows what went out. `tpl` = { name, language, bodyParams,
// text? }; `sender` marks who chose it (AI / SYSTEM / AGENT).
const sendAndSaveTemplate = async ({ tenant, conversation, tenantId, phone, lead, tpl, sender = 'SYSTEM', rawResponse = null }) => {
  if (!tpl?.name) return { sent: false, reason: 'no_template', waMessageId: null };
  const firstName = (lead?.contact?.name || '').trim().split(/\s+/)[0] || 'dost';
  const render = (t) => String(t || '').replace(/\{name\}/gi, firstName);
  const params = (tpl.bodyParams?.length ? tpl.bodyParams : ['{name}']).map((p) => ({ type: 'text', text: render(p) }));
  let waMessageId = null;
  let sendError = null;
  try {
    waMessageId = await whatsappService.sendTemplate(tenant, phone, tpl.name, tpl.language || 'en', [{ type: 'body', parameters: params }]);
  } catch (err) {
    sendError = err?.response?.data?.error?.message || err?.message || 'send_failed';
    logger.error({ err: sendError, tenantId, phone, template: tpl.name }, 'Failed to send WA template');
  }
  await prisma.message.create({
    data: {
      tenantId, conversationId: conversation.id, waMessageId,
      direction: 'OUTBOUND', sender, type: 'TEMPLATE',
      content: render(tpl.text) || `[template ${tpl.name}]`,
      status: waMessageId ? 'SENT' : 'FAILED',
      aiTokensUsed: 0,
      aiRawResponse: rawResponse || { template: tpl.name },
    },
  });
  return { sent: !!waMessageId, reason: waMessageId ? `template:${tpl.name}` : (sendError || 'wa_send_failed'), waMessageId, template: tpl.name };
};

const handleHandoff = async (tenant, conversation, lead, reason) => {
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      status: 'HUMAN_TAKEOVER',
      aiEnabled: false,
      handoffReason: reason || 'Manual handoff',
      handoffAt: new Date(),
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


module.exports = {
  DUPLICATE_REPLY_WINDOW_MS,
  isRepeatOfLastReply,
  sendPaymentInstructions,
  sendAndSaveReply,
  sendAndSaveTemplate,
  handleHandoff,
};
