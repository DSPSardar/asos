// src/workers/conversation.worker.js
// BullMQ worker — processes every inbound WhatsApp message
// Orchestrates: CRM resolution → Claude AI → WA reply → Meta attribution

require('dotenv').config();
const { Worker } = require('bullmq');
const redis = require('../config/redis');
const prisma = require('../config/database');
const claudeService = require('../services/claude.service');
const whatsappService = require('../services/whatsapp.service');
const welcomeVoiceService = require('../modules/ai-config/welcomeVoice.service');
const elevenlabsService = require('../services/elevenlabs.service');
const transcriptionService = require('../services/transcription.service');
const metaService = require('../services/meta.service');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');
const { publishStatusUpdate } = require('../queues/message.queue');
const { QUEUE_NAMES } = require('../queues/message.queue');
const env = require('../config/env');

// ─────────────────────────────────────────────────────────────────────
// PER-CONVERSATION LOCK
// ─────────────────────────────────────────────────────────────────────
// The worker runs with concurrency:10 so unrelated leads process in
// parallel, but two messages from the SAME lead arriving close together
// must never run concurrently: each independently reads messageHistory
// before the other's reply is saved, so a concurrent run has no idea the
// other message exists and produces a stale/repeated answer instead of
// addressing the new one. This serializes per (tenant, phone) without
// touching cross-lead throughput.

const LOCK_TTL_MS = 30000;

const acquireConversationLock = async (lockKey, token, { ttlMs = LOCK_TTL_MS, maxWaitMs = 20000, pollMs = 250 } = {}) => {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (acquired) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
};

// The TTL is a crash safety net, but a healthy job can legitimately outrun it:
// a voice note means media download + transcription before the two LLM calls
// even start. When the TTL expired mid-flight the next message for the same
// lead took the lock and read a history that didn't contain the in-flight
// reply yet — both jobs then answered the same pending question, which is the
// lead receiving the same reply twice. Extend the lock while we still hold it
// so it only ever expires when the worker has actually died.
const startLockHeartbeat = (lockKey, token, ttlMs = LOCK_TTL_MS) => {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    end
    return 0
  `;
  const timer = setInterval(() => {
    redis.eval(script, 1, lockKey, token, String(ttlMs)).catch(() => {});
  }, Math.floor(ttlMs / 3));
  timer.unref?.();
  return () => clearInterval(timer);
};

const releaseConversationLock = async (lockKey, token) => {
  // Compare-and-delete so we never release a lock some other job acquired
  // after ours expired — the TTL is a crash safety net, not the common path.
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `;
  await redis.eval(script, 1, lockKey, token).catch(() => {});
};

// ─────────────────────────────────────────────────────────────────────
// MAIN JOB PROCESSOR
// ─────────────────────────────────────────────────────────────────────

const processInboundMessage = async (job) => {
  const { tenantId, phone } = job.data;
  const lockKey = `asos:lock:msg:${tenantId}:${whatsappService.normalizePhone(phone)}`;
  const lockToken = String(job.id);

  const gotLock = await acquireConversationLock(lockKey, lockToken);
  if (!gotLock) {
    // Another message for this same lead is still mid-processing — throw
    // so BullMQ retries with its existing backoff instead of racing ahead.
    throw new Error(`Could not acquire conversation lock for ${lockKey} — retrying`);
  }

  const stopHeartbeat = startLockHeartbeat(lockKey, lockToken);

  try {
    await handleInboundMessage(job);
  } finally {
    stopHeartbeat();
    await releaseConversationLock(lockKey, lockToken);
  }
};

const handleInboundMessage = async (job) => {
  let { tenantId, phone, contactName, content, waMessageId, messageType,
        referral, mediaId, timestamp, replay } = job.data;

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

  if (!tenant.waPhoneId && env.WHATSAPP_MOCK !== 'true') {
    logger.warn({ tenantId }, 'No WA phone configured — skipping');
    return;
  }

  // ── 1b. Transcribe inbound voice notes ─────────────────────────────
  // extractMessageContent() only returns a '[Audio message]' placeholder —
  // it's synchronous and can't do the download + Whisper round trip. Do
  // that here instead, before `content` is saved or handed to the AI, so
  // the placeholder never leaks downstream. Falls back to an explicit
  // "could not transcribe" marker on any failure rather than pretending
  // the AI understood a voice note it never actually heard.
  if (messageType === 'audio' && mediaId) {
    const media = await whatsappService.downloadMedia(tenant, mediaId);
    const transcript = media ? await transcriptionService.transcribeAudio(media.buffer, media.mimeType) : null;
    content = transcript || '[Voice message — could not transcribe]';
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

  // A lead we are still waiting on payment proof for is not finished, whatever
  // its stage says. The enrollment handoff marks a lead CLOSED_WON the moment
  // it confirms — seconds before the screenshot actually arrives — so the
  // filter above excluded exactly the lead the payment belongs to. The image
  // then opened a second lead on the same contact, with a second conversation
  // whose paymentDetailsSentAt was null, so proof detection could not fire: the
  // screenshot fell through to the Qualifier, which sees the literal "[Image]",
  // scored it COLD and asked a fresh Phase-1 question. Observed in production —
  // contact 76400f6c got leads b6cb9051 and ac8ab365 forty seconds apart.
  if (!lead) {
    const awaitingProof = await prisma.conversation.findFirst({
      where: {
        tenantId,
        contactId: contact.id,
        paymentDetailsSentAt: { not: null },
        paymentProofDetected: false,
      },
      orderBy: { paymentDetailsSentAt: 'desc' },
      include: { lead: true },
    });

    if (awaitingProof?.lead) {
      lead = awaitingProof.lead;
      logger.info({ leadId: lead.id, contactId: contact.id, conversationId: awaitingProof.id },
        '🏦 Reusing lead still awaiting payment proof instead of opening a new one');
    }
  }

  const isNewLead = !lead;

  if (!lead) {
    // Extract Meta Ads attribution from WA referral (Click-to-WA)
    const adAttribution = extractAdAttribution(referral);

    // Always tag inbound WA leads; Meta ad attribution overrides if present
    const waBaseline = { sourceUtm: { source: 'whatsapp', medium: 'whatsapp' } };
    lead = await prisma.lead.create({
      data: {
        tenantId,
        contactId: contact.id,
        stage: 'NEW',
        scoreLabel: 'COLD',
        aiScore: 0,
        ...waBaseline,
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

    // Notify admin of new lead
    notificationService.notifyAdmin(tenant, 'newLead', { contactName: contact.name, phone: normalizedPhone });

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

  // ── 6. Persist inbound message to DB (idempotent per waMessageId) ─
  // Everything below this point talks to the lead, so the pipeline must run
  // at most once per inbound message. waMessageId is unique, so an existing
  // row means we have already been here: a BullMQ retry, a webhook redelivery
  // that outlived the 24h Redis dedup key, or a handback re-queue. Re-running
  // would send the lead a second copy of the same answer.
  const existingInbound = waMessageId
    ? await prisma.message.findFirst({ where: { waMessageId, tenantId } })
    : null;

  if (existingInbound) {
    // Already stored. The only question that matters is whether it was also
    // already answered — if something went out after it, replying again means
    // the lead reads the same message twice. If nothing did, the earlier run
    // died before it could reply and finishing the job is the right call.
    const outboundSince = await prisma.message.count({
      where: {
        conversationId: existingInbound.conversationId,
        tenantId,
        direction: 'OUTBOUND',
        sentAt: { gte: existingInbound.sentAt },
      },
    });

    if (outboundSince > 0) {
      logger.info({ waMessageId, conversationId: conversation.id, replay: !!replay },
        '⏭  Message already answered — skipping to avoid a duplicate reply');
      return;
    }

    logger.info({ waMessageId, conversationId: conversation.id, replay: !!replay },
      '↻ Re-processing a stored message that never got a reply');
  }

  // Reuse the stored row on replay: inserting a second copy would duplicate
  // the lead's question in the transcript, and the AI would then read a
  // conversation where it was asked the same thing twice.
  const inboundMessage = existingInbound || await prisma.message.create({
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

  // ── 6b. Welcome voice note — bypass the AI entirely on this contact's
  // first ever inbound message. contact.sentWelcomeVoice is flipped true
  // via a conditional update BEFORE the send is awaited, so the update
  // itself is the idempotency lock against webhook retries: only one
  // concurrent run can win the false→true flip. Trade-off, accepted on
  // purpose — if the send then fails, the contact won't get a retry of
  // the voice note on their next message rather than risking a double-send.
  logger.info({
    contactId: contact.id,
    welcomeVoiceEnabled: tenant.aiConfig?.welcomeVoiceEnabled ?? null,
    hasWelcomeVoiceMediaId: !!tenant.aiConfig?.welcomeVoiceMediaId,
    sentWelcomeVoice: contact.sentWelcomeVoice,
  }, '🔍 Welcome voice gate check');

  if (tenant.aiConfig?.welcomeVoiceEnabled && tenant.aiConfig?.welcomeVoiceMediaId && !contact.sentWelcomeVoice) {
    const claimed = await prisma.contact.updateMany({
      where: { id: contact.id, sentWelcomeVoice: false },
      data: { sentWelcomeVoice: true },
    });

    if (claimed.count === 1) {
      // The sentWelcomeVoice flag is already committed at this point, so this
      // contact gets exactly one shot at the voice note — if anything below
      // throws uncaught, the job retries, sees the flag already true, skips
      // this whole branch, and falls straight into a normal AI reply on what
      // was supposed to be the intro-only turn. Catch everything so a failure
      // here degrades to "no voice note, still no AI reply this turn" instead.
      try {
        let welcomeWaMessageId = null;
        try {
          welcomeWaMessageId = await welcomeVoiceService.sendWelcomeVoice(tenant, tenant.aiConfig, normalizedPhone);
        } catch (err) {
          logger.error({ err, contactId: contact.id }, 'Welcome voice note send failed');
        }

        await prisma.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            waMessageId: welcomeWaMessageId,
            direction: 'OUTBOUND',
            sender: 'AI',
            type: 'AUDIO',
            content: '[Welcome voice note]',
            status: welcomeWaMessageId ? 'SENT' : 'FAILED',
          },
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });

        logger.info({ contactId: contact.id, conversationId: conversation.id, sent: !!welcomeWaMessageId },
          '🎙️ Welcome voice note sent — skipping Qualifier/Closer for this turn');
      } catch (err) {
        logger.error({ err, contactId: contact.id }, 'Welcome voice note bookkeeping failed after claiming the flag — skipping AI this turn anyway');
      }
      return;
    }
  }

  // ── 6c. Payment proof ─────────────────────────────────────────────
  // A payment screenshot reaches the AI as the literal string "[Image]" —
  // there is nothing in it for a model to reason about, so this is decided in
  // code, not by the Closer. Guarded by paymentDetailsSentAt: an image only
  // counts as proof if we actually asked this lead to pay, otherwise any photo
  // (an ad screenshot, a CV, a meme) would mark them as paid.
  const PROOF_MESSAGE_TYPES = ['image', 'document'];
  const isPaymentProof =
    PROOF_MESSAGE_TYPES.includes((messageType || '').toLowerCase()) &&
    !!conversation.paymentDetailsSentAt &&
    !conversation.paymentProofDetected;

  if (isPaymentProof) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        paymentProofDetected: true,
        paymentProofAt: new Date(),
        status: 'PENDING_VERIFICATION',
        aiEnabled: false,
        handoffReason: 'Payment proof received — awaiting human verification',
      },
    });

    const ackMessage = tenant.aiConfig?.paymentProofMessage?.trim()
      || 'Thank you! We have received your payment confirmation. Our team will verify it and confirm your seat shortly. 🙏';

    await sendAndSaveReply({
      tenant, conversation, tenantId,
      phone: normalizedPhone,
      content: ackMessage,
      tokensUsed: 0,
      rawResponse: null,
    });

    await prisma.activity.create({
      data: {
        tenantId,
        leadId: lead.id,
        type: 'AI_ACTION',
        content: '💳 Payment proof received — conversation moved to verification queue',
        metadata: { flag: 'payment_proof_detected', messageType, waMessageId },
      },
    });

    notificationService.notifyAdmin(tenant, 'needsHuman', {
      contactName: contact.name,
      phone: normalizedPhone,
      reason: 'Payment proof received — verify and confirm the seat',
    });

    logger.info({ leadId: lead.id, conversationId: conversation.id },
      '💳 Payment proof detected — AI paused, awaiting human verification');
    return;
  }

  // ── 7. Check if AI is enabled for this conversation ───────────────
  // aiEnabled is the single source of truth — do NOT check status here.
  // toggleAI and handback both reset status to AI_HANDLING when re-enabling,
  // so checking status would block AI even after a valid handback/toggle.
  const freshConv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  if (!freshConv?.aiEnabled) {
    logger.info({ conversationId: conversation.id }, 'AI disabled — message delivered to agent inbox only');
    return;
  }

  // ── 7b. Detect if conversation is under persistent AI control ────────
  // Redis flag set by handback(), cleared by takeover(). Suppresses Claude's
  // auto-handoff for HOT leads when a human has deliberately returned control to AI.
  const aiControlFlag = await redis.get(`asos:ai_control:${conversation.id}`).catch(() => null);
  const handedBackToAI = aiControlFlag === '1';

  // ── 8. Load message history for context ──────────────────────────
  const messageHistory = await prisma.message.findMany({
    where: { conversationId: conversation.id, tenantId },
    orderBy: { sentAt: 'asc' },
    select: { id: true, sender: true, content: true, sentAt: true },
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
      // Exclude by id, not position: sentAt mixes WhatsApp's own inbound
      // timestamp with our server wall-clock outbound timestamp, so a fast
      // follow-up can sort earlier than the AI's own just-saved reply —
      // slicing off "the last item" would then strip that reply instead
      // of the current message, and the AI would never see it already
      // answered.
      messageHistory: messageHistory.filter((m) => m.id !== inboundMessage.id),
      handedBackToAI,
      welcomeVoiceAlreadySent: !!(tenant.aiConfig?.welcomeVoiceEnabled && contact.sentWelcomeVoice),
    });
  } catch (aiErr) {
    logger.error({ aiErr, leadId: lead.id }, 'Claude processing failed — handing off to agent');
    await handleHandoff(tenant, conversation, lead, 'AI service error — automatic handoff');
    return;
  }

  // ── 10. Update CRM with AI results (v1.5 — Qualifier + Closer outputs) ──
  const prevStage = lead.stage;

  // Only update businessUnit if the AI identified a non-UNKNOWN value;
  // never overwrite a confirmed DSP/SDC tag back to UNKNOWN mid-conversation.
  const resolvedBusinessUnit = aiResult.businessUnit && aiResult.businessUnit !== 'UNKNOWN'
    ? aiResult.businessUnit
    : (lead.businessUnit !== 'UNKNOWN' ? lead.businessUnit : 'UNKNOWN');

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
      leadTemperature:        aiResult.leadStatus || 'WARM',
      businessUnit:           resolvedBusinessUnit,
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

    // Notify admin of HOT lead
    notificationService.notifyAdmin(tenant, 'hotLead', {
      contactName: contact.name,
      phone: normalizedPhone,
      score: aiResult.score,
    });
  }

  // Settings rule: "unanswered" — notify when the Closer couldn't answer a
  // question from PRODUCT CONTEXT (see knowledge_gap in claude.service.js).
  // This toggle existed in Settings.jsx and did nothing until now. Notify
  // only, not a handoff — the AI keeps selling; the owner gets a heads-up
  // there's a gap worth filling in their knowledge base. Defaults true, like
  // payment/legal, so existing tenants keep getting it unless they turn it
  // off explicitly.
  if (aiResult.closerOutput?.knowledge_gap && tenant.aiConfig?.handoffRules?.unanswered !== false) {
    notificationService.notifyAdmin(tenant, 'unansweredQuestion', {
      contactName: contact.name,
      phone: normalizedPhone,
      question: aiResult.closerOutput.knowledge_gap,
    });
  }

  // ── 11. Route based on AI action ─────────────────────────────────

  if (aiResult.action === 'handoff') {
    // A) Human handoff — send closer reply first (if any), then farewell, then handoff
    if (aiResult.reply) {
      await sendAndSaveReply({ tenant, conversation, tenantId, phone: normalizedPhone,
        content: aiResult.reply, tokensUsed: aiResult.tokensUsed, rawResponse: aiResult });
    }

    // A lead reaches this branch by confirming enrollment — they said yes and
    // are waiting to pay. The Closer is skipped on handoff, so nobody would
    // otherwise give them the account details, and they'd get a "we'll be in
    // touch" farewell with no way to actually pay. Send the configured block
    // before handing over.
    let paymentDetailsJustSent = false;
    if (aiResult.enrollmentConfirmed) {
      paymentDetailsJustSent = await sendPaymentInstructions({ tenant, conversation, tenantId, phone: normalizedPhone });
    }

    // The farewell is a goodbye — "thanks for your time, our team will be in
    // touch, stay available". Sent straight after the account details it
    // contradicts them: the lead has just been asked to transfer money and send
    // a screenshot, and is then told to sit and wait. Observed live — a lead
    // said "I want to join Monday's batch", got the bank block, and was waved
    // off one minute later.
    //
    // When the details went out they already end with the instruction, so the
    // farewell is skipped. It still sends for every other handoff reason, where
    // "a human will contact you" is the right and only thing to say.
    if (!paymentDetailsJustSent) {
      const farewellMsg = tenant.aiConfig?.handoffMessage ||
        '🙏 Shukriya apna waqt dene ka! Hamari team bohat jald aap se rabta karegi. Please available rahein. ✨';
      await sendAndSaveReply({ tenant, conversation, tenantId, phone: normalizedPhone,
        content: farewellMsg, tokensUsed: 0, rawResponse: null });
    }

    await handleHandoff(tenant, conversation, lead, aiResult.handoffReason);

    // Notify admin on WhatsApp
    notificationService.notifyAdmin(tenant, 'needsHuman', {
      contactName: contact.name,
      phone: normalizedPhone,
      reason: aiResult.handoffReason,
    });

    return;
  }

  if (aiResult.action === 'close') {
    // B) The lead said yes. That is an intention, not a payment — nobody has
    // checked a bank statement. The lead stays at PROPOSED and is booked only
    // by confirmPayment(), when a human has verified the transfer.
    //
    // The Meta Purchase event moves with it, for the same reason: firing it
    // here reported a conversion for every lead who merely agreed, training
    // Meta's optimiser on people who never paid.
    await prisma.activity.create({
      data: {
        tenantId,
        leadId: lead.id,
        type: 'AI_ACTION',
        content: 'AI detected closing signal — awaiting payment verification',
        metadata: { closedBy: 'AI', urgencyTrigger: aiResult.urgencyTrigger, awaitingVerification: true },
      },
    });
  }

  if (aiResult.action === 'close_lost') {
    // B2) Lead refused after multiple re-engagement attempts → mark LOST, send farewell, stop AI
    await prisma.lead.update({
      where: { id: lead.id },
      data: { stage: 'CLOSED_LOST', closedAt: new Date() },
    });

    await prisma.activity.create({
      data: {
        tenantId,
        leadId: lead.id,
        type: 'STAGE_CHANGE',
        content: 'AI marked lead as LOST — persistent refusal after re-engagement attempts',
        metadata: { closedBy: 'AI' },
      },
    });

    logger.info({ leadId: lead.id }, '☠️  Lead marked CLOSED_LOST by AI after persistent refusal');
    // Farewell reply is already in aiResult.reply — fall through to sendAndSaveReply below
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

  // D) Payment instructions, sent verbatim from config as their own message.
  // The AI writes the lead-in and raises the flag, but never the account
  // numbers themselves: a generated reply is length-capped and free to reword,
  // and a mistyped IBAN sends the lead's money to nobody.
  if (aiResult.sendPaymentDetails) {
    await sendPaymentInstructions({ tenant, conversation, tenantId, phone: normalizedPhone });
  }

  logger.info({ leadId: lead.id, action: aiResult.action, stage: aiResult.stage }, '✅ Message processed');
};

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

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
    rawResponse: null,
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { paymentDetailsSentAt: new Date() },
  });

  logger.info({ conversationId: conversation.id }, '🏦 Payment details sent from config');
  return true;
};

const sendAndSaveReply = async ({ tenant, conversation, tenantId, phone, content, tokensUsed, rawResponse }) => {
  let waMessageId = null;

  if (!content?.trim()) {
    logger.warn({ tenantId, conversationId: conversation.id }, 'Empty reply — nothing sent');
    return;
  }

  if (await isRepeatOfLastReply({ conversation, tenantId, content })) {
    logger.warn({ tenantId, conversationId: conversation.id, preview: content.slice(0, 80) },
      '🚫 Suppressed duplicate reply — identical text already sent to this lead');
    return;
  }

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

  // ── Optional voice-note follow-up, in the owner's ElevenLabs cloned voice.
  // Best-effort and fully isolated: the text reply above has already been
  // sent and saved, so nothing here can affect it.
  if (elevenlabsService.isVoiceCloneConfigured()) {
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
            content,
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
