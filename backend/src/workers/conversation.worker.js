// src/workers/conversation.worker.js
// BullMQ worker — processes every inbound WhatsApp message
// Orchestrates: CRM resolution → Claude AI → WA reply → Meta attribution

// Must be the first require in the file — see instrument.js for why. Also
// calls dotenv.config(), replacing the old standalone call that used to be
// the first line here.
require('../instrument');
const Sentry = require('@sentry/node');

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
const realtimeService = require('../services/realtime.service');
const billingService = require('../modules/billing/billing.service');
const { toDbMessageType } = require('../utils/messageType');
const { sanitizeHistoryForAI } = require('../utils/aiHistory');
const logger = require('../utils/logger');
const { requestContext } = require('../middleware/requestContext.middleware');
const { publishStatusUpdate, registerWeeklyDigest, registerAutomationTick, registerSheetsSyncTick } = require('../queues/message.queue');
const { QUEUE_NAMES } = require('../queues/message.queue');
const env = require('../config/env');

// See server.js for the matching handlers and why they exist. concurrency:10
// below means several unrelated jobs may be in flight when one throws
// something BullMQ's own per-job try/catch never sees — that is by
// definition a bug loose enough to have escaped every existing handler, and
// Railway's restartPolicy (railway.toml, ON_FAILURE, 5 retries) is the
// intended safety net for that, not staying up in an unknown state.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception in worker — process exiting');
  Sentry.captureException(err);
  Sentry.flush(2000).finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection in worker — process exiting');
  Sentry.captureException(reason);
  Sentry.flush(2000).finally(() => process.exit(1));
});

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

  // ── 1c. Persist inbound image/document/video to disk ──────────────
  // extractMessageContent() only ever gives the AI (and the conversation
  // view) a placeholder string like "[Image]" — there was never a URL for
  // the dashboard to render. Download once here and keep the real file so
  // the message row can carry a permanent mediaUrl instead of just text.
  // Best-effort: a failed download still leaves the placeholder content and
  // the message continues through the normal pipeline below.
  let mediaUrl = null;
  let savedMedia = null;
  if (['image', 'video', 'document'].includes(messageType) && mediaId) {
    savedMedia = await whatsappService.saveInboundMedia(tenant, mediaId, { messageType });
    mediaUrl = savedMedia?.url || null;
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

  // A contact whose latest lead is CLOSED_WON is an enrolled student, not a
  // fresh prospect. Creating a new lead here is what produced 12 leads for one
  // contact in production — every new conversation opened one and each got
  // marked won again, inflating Won 2x. Reuse the won lead instead: the
  // Qualifier cannot downgrade it (deriveStage is monotonic and CLOSED_WON is
  // terminal), no Meta "Lead" event fires, and the admin is not notified that
  // an enrolled student is a "new lead". A CLOSED_LOST contact coming back
  // still gets a fresh lead — that genuinely is a new opportunity.
  if (!lead) {
    const wonLead = await prisma.lead.findFirst({
      where: { tenantId, contactId: contact.id, stage: 'CLOSED_WON' },
      orderBy: { createdAt: 'desc' },
    });
    if (wonLead) {
      lead = wonLead;
      logger.info({ leadId: lead.id, contactId: contact.id },
        '🎓 Returning enrolled student — reusing CLOSED_WON lead instead of opening a new one');
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

    await prisma.leadStageHistory.create({
      data: { tenantId, leadId: lead.id, fromStage: null, toStage: 'NEW', changedBy: null },
    }).catch(() => {});

    // Mirror the new lead into the tenant's Google Sheet (debounced, non-blocking).
    require('../services/sheetsSync.service').scheduleSync(tenantId);

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

    // Push the new lead to every open dashboard tab. Without this the pipeline
    // only picks up an inbound lead on a manual page reload — the socket fans
    // out through Redis, so this worker process reaches the API's clients.
    realtimeService.broadcastLeadsRefresh(tenantId).catch(() => {});
    realtimeService.broadcastDashboardUpdate(tenantId).catch(() => {});

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
  //
  // toDbMessageType() guards against WhatsApp event types the database
  // enum has no room for (reaction, location, button, sticker, video,
  // etc.) — see utils/messageType.js for why this exists: an unguarded
  // write here was the confirmed cause of leads going unanswered after
  // sending an emoji reaction (2026-08-14, "Invalid value for argument
  // `type`. Expected MessageType." crashing the job on every retry).
  const dbMessageType = toDbMessageType(messageType);

  const inboundMessage = existingInbound || await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      waMessageId,
      direction: 'INBOUND',
      sender: 'CONTACT',
      type: dbMessageType,
      content: content || null,
      mediaUrl,
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
  // A payment screenshot used to reach the AI as the literal string "[Image]"
  // and this branch decided proof-or-not purely from messageType + timing —
  // no one and nothing ever looked at the picture. Observed in production:
  // a lead sent a screenshot of the refund policy (not a receipt) after
  // payment details had gone out, and got told "payment received, seat
  // confirmed" anyway. Guarded by paymentDetailsSentAt: an image only even
  // gets *considered* proof if we actually asked this lead to pay — but from
  // here on, an image additionally has to pass classifyPaymentProofImage()
  // before it's allowed to auto-confirm anything.
  //
  // Documents (PDF receipts etc.) have no cheap vision check available here
  // and keep the previous type+timing behavior — this fix targets the
  // specific failure that was observed and reported (image, not document).
  const PROOF_MESSAGE_TYPES = ['image', 'document'];
  const isCandidateProof =
    PROOF_MESSAGE_TYPES.includes((messageType || '').toLowerCase()) &&
    !!conversation.paymentDetailsSentAt &&
    !conversation.paymentProofDetected;

  let isPaymentProof = isCandidateProof && messageType !== 'image';
  let imageClassification = null;

  if (isCandidateProof && messageType === 'image') {
    if (savedMedia?.buffer) {
      imageClassification = await claudeService.classifyPaymentProofImage(savedMedia.buffer, savedMedia.mimeType);
      isPaymentProof = imageClassification.isPaymentProof;
      logger.info({ conversationId: conversation.id, ...imageClassification }, '🖼️ Payment-proof image classified');
    } else {
      // Image failed to download — nothing to classify. Fail closed (same
      // rationale as classifyPaymentProofImage itself): don't auto-confirm
      // a payment no one actually looked at.
      logger.warn({ conversationId: conversation.id, mediaId }, 'Payment-proof candidate image had no downloadable buffer — treating as not-proof');
    }
  }

  if (isCandidateProof && messageType === 'image' && !isPaymentProof) {
    const classificationFailed = imageClassification?.reason === 'classification_failed';

    if (classificationFailed) {
      // We genuinely don't know what this image is — the vision call itself
      // errored (network, rate limit, model outage), not "the model looked
      // and it wasn't a receipt." Falling through to the normal Closer here
      // was the actual bug behind the incident this branch is named after:
      // the Closer would generate its own reassuring "verifying, please
      // wait" reply from the payment-instructions system prompt language,
      // with no real verification happening and no one ever notified —
      // worse than either genuine outcome, because it tells the customer
      // something false while telling the admin nothing at all. Escalate
      // to human review exactly like a confirmed receipt would, just with
      // an honest message and a distinguishable reason so the dashboard
      // shows this wasn't actually confirmed.
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: 'PENDING_VERIFICATION',
          aiEnabled: false,
          handoffReason: 'Payment image could not be auto-verified (classification failed) — please check manually',
        },
      });

      const ackMessage = tenant.aiConfig?.paymentProofMessage?.trim()
        || "Thank you for the screenshot! I'm having a little trouble verifying it automatically, but our team will check it and confirm your seat shortly. 🙏";

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
          content: '⚠️ Payment image could not be auto-verified — escalated for manual check',
          metadata: { flag: 'payment_proof_classification_failed', messageType, waMessageId },
        },
      });

      notificationService.notifyAdmin(tenant, 'needsHuman', {
        contactName: contact.name,
        phone: normalizedPhone,
        reason: "Payment image sent but couldn't be auto-verified — please check manually",
      });

      logger.info({ leadId: lead.id, conversationId: conversation.id },
        '⚠️ Payment-proof classification failed — AI paused, awaiting manual check');
      return;
    }

    // Confident rejection (the model actually looked and it isn't a
    // receipt): don't touch conversation/lead state and don't send the
    // "payment received" ack. Fall through to the normal Qualifier/Closer
    // pipeline below so the lead gets a real reply about whatever they
    // actually sent (e.g. "that's the refund policy, not a receipt — could
    // you send the bank transfer screenshot instead?").
    await prisma.activity.create({
      data: {
        tenantId,
        leadId: lead.id,
        type: 'AI_ACTION',
        content: '🖼️ Image received after payment instructions, but did not look like a receipt — not auto-confirmed',
        metadata: { flag: 'payment_proof_rejected', messageType, waMessageId, reason: imageClassification?.reason || null },
      },
    });
  }

  if (isPaymentProof) {
    // ── Reviewer signals, not auto-decisions ─────────────────────────
    // Human verification stays the gate; these checks arm the reviewer:
    //  • duplicate: the exact same file bytes were already submitted to this
    //    tenant (classic reused-screenshot fraud) — the receipt "looks real"
    //    because it IS real, just already spent.
    //  • amount mismatch: the receipt's extracted amount differs from the
    //    tenant's configured enrollment fee.
    let duplicateOf = null;
    if (savedMedia?.sha256 && savedMedia?.mediaRowId) {
      duplicateOf = await prisma.inboundMedia.findFirst({
        where: { tenantId, sha256: savedMedia.sha256, NOT: { id: savedMedia.mediaRowId } },
        select: { id: true, createdAt: true },
      }).catch(() => null);
    }

    const expectedFee = Number(tenant.settings?.enrollmentFee) || null;
    const extractedAmount = imageClassification?.amount || null;
    const amountMismatch = Boolean(expectedFee && extractedAmount && extractedAmount !== expectedFee);
    const suspicious = Boolean(duplicateOf) || amountMismatch;

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        paymentProofDetected: true,
        paymentProofAt: new Date(),
        status: 'PENDING_VERIFICATION',
        aiEnabled: false,
        handoffReason: duplicateOf
          ? '⚠️ Payment proof is a DUPLICATE of an earlier submission — verify carefully'
          : amountMismatch
            ? `⚠️ Payment proof amount (${extractedAmount}) does not match the expected fee (${expectedFee}) — verify carefully`
            : 'Payment proof received — awaiting human verification',
      },
    });

    // A suspicious proof gets the neutral "we'll verify" wording, never the
    // configured "payment received" celebration.
    const ackMessage = suspicious
      ? 'Thank you for the screenshot! Our team will verify the payment and confirm your seat shortly. 🙏'
      : (tenant.aiConfig?.paymentProofMessage?.trim()
        || 'Thank you! We have received your payment confirmation. Our team will verify it and confirm your seat shortly. 🙏');

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
        content: duplicateOf
          ? '🚨 Payment proof received — but the identical image was submitted before. Possible reused screenshot.'
          : amountMismatch
            ? `🚨 Payment proof received — extracted amount ${extractedAmount} does not match expected fee ${expectedFee}.`
            : '💳 Payment proof received — conversation moved to verification queue',
        metadata: {
          flag: suspicious ? 'payment_proof_suspicious' : 'payment_proof_detected',
          messageType,
          waMessageId,
          sha256: savedMedia?.sha256 || null,
          duplicateOfMediaId: duplicateOf?.id || null,
          extracted: imageClassification ? {
            amount: imageClassification.amount,
            currency: imageClassification.currency,
            date: imageClassification.date,
            reference: imageClassification.reference,
          } : null,
          expectedFee,
        },
      },
    });

    notificationService.notifyAdmin(tenant, 'needsHuman', {
      contactName: contact.name,
      phone: normalizedPhone,
      reason: duplicateOf
        ? '🚨 Payment proof received but it is an EXACT duplicate of an earlier screenshot — check before confirming'
        : amountMismatch
          ? `🚨 Payment proof received but the amount (${extractedAmount}) does not match the fee (${expectedFee}) — check before confirming`
          : 'Payment proof received — verify and confirm the seat',
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

  // ── 7c. Enforce the plan's AI token limit ─────────────────────────
  // aiTokensUsed has always been incremented (claude.service.js §8) but the
  // limit was never checked anywhere on this path — a FREE tenant could burn
  // unbounded OpenAI spend. On limit, hand off so a human sees the lead
  // rather than the conversation going silent; handleHandoff disables AI, so
  // this fires once per conversation, not per message.
  try {
    await billingService.checkPlanLimits(tenantId, 'ai_tokens');
  } catch (limitErr) {
    if (limitErr.statusCode === 402) {
      logger.warn({ tenantId, leadId: lead.id }, '💸 AI token limit reached — handing conversation to human');
      await handleHandoff(tenant, conversation, lead, 'AI token limit reached — plan upgrade required');
      notificationService.notifyAdmin(tenant, 'needsHuman', {
        contactName: contact.name,
        phone: normalizedPhone,
        reason: 'AI token limit reached — AI paused for this conversation until the plan is upgraded',
      });
      return;
    }
    throw limitErr;
  }

  // ── 8. Load message history for context ──────────────────────────
  // Outbound AI AUDIO rows are excluded: each is just the voice-note twin of
  // the text reply right before it (older rows even carry the identical
  // text), so including them doubled every AI reply in the LLM's view of the
  // conversation — and inflated the old raw messageCount the Closer's phase
  // logic ran on. Inbound audio stays: it's the lead's actual (transcribed)
  // message.
  const messageHistory = (await prisma.message.findMany({
    where: { conversationId: conversation.id, tenantId },
    orderBy: { sentAt: 'asc' },
    select: { id: true, sender: true, content: true, sentAt: true, type: true, direction: true },
  })).filter((m) => !(m.type === 'AUDIO' && m.direction === 'OUTBOUND'));

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
      // sanitizeHistoryForAI: the payment-details block lives in the Message
      // table for the dashboard, but bank account numbers must never reach
      // the LLM provider — see utils/aiHistory.js.
      messageHistory: sanitizeHistoryForAI(
        messageHistory.filter((m) => m.id !== inboundMessage.id),
        tenant.aiConfig?.paymentDetails
      ),
      handedBackToAI,
      welcomeVoiceAlreadySent: !!(tenant.aiConfig?.welcomeVoiceEnabled && contact.sentWelcomeVoice),
    });
  } catch (aiErr) {
    logger.error({ aiErr, leadId: lead.id }, 'Claude processing failed — handing off to agent');
    await handleHandoff(tenant, conversation, lead, 'AI service error — automatic handoff');
    return;
  }

  // ── 9b. Persist Qualifier classification on the inbound message ────
  // Powers /insights sentiment + signal endpoints. Best-effort: a failure
  // here must never block the reply pipeline.
  try {
    await prisma.message.update({
      where: { id: inboundMessage.id },
      data: { sentiment: aiResult.sentiment || null, signalType: aiResult.signalType || null },
    });
  } catch (clsErr) {
    logger.warn({ clsErr, messageId: inboundMessage.id }, 'Failed to save message classification');
  }

  // ── 10. Update CRM with AI results (v1.5 — Qualifier + Closer outputs) ──
  const prevStage = lead.stage;

  // Only update businessUnit if the AI identified a non-UNKNOWN value;
  // never overwrite a confirmed DSP/SDC tag back to UNKNOWN mid-conversation.
  const resolvedBusinessUnit = aiResult.businessUnit && aiResult.businessUnit !== 'UNKNOWN'
    ? aiResult.businessUnit
    : (lead.businessUnit !== 'UNKNOWN' ? lead.businessUnit : 'UNKNOWN');

  // Same never-downgrade rule as businessUnit: once a lead has chosen an offer
  // (BOOTCAMP / MASTERY) a later UNKNOWN must not erase it.
  const resolvedProduct = aiResult.product && aiResult.product !== 'UNKNOWN'
    ? aiResult.product
    : (lead.product || null);

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      stage: aiResult.stage,
      product: resolvedProduct,
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
    await prisma.leadStageHistory.create({
      data: { tenantId, leadId: lead.id, fromStage: prevStage, toStage: aiResult.stage, changedBy: null },
    }).catch(() => {}); // history is telemetry, never blocks message processing
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
    await prisma.leadStageHistory.create({
      data: { tenantId, leadId: lead.id, fromStage: aiResult.stage || lead.stage, toStage: 'CLOSED_LOST', changedBy: null },
    }).catch(() => {});

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
    return;
  }

  if (await isRepeatOfLastReply({ conversation, tenantId, content })) {
    logger.warn({ tenantId, conversationId: conversation.id, preview: content.slice(0, 80) },
      '🚫 Suppressed duplicate reply — identical text already sent to this lead');
    return;
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
  const { waMessageId, status, tenantId } = job.data;

  const statusMap = {
    SENT: 'SENT', DELIVERED: 'DELIVERED', READ: 'READ', FAILED: 'FAILED',
  };

  const mappedStatus = statusMap[status.toUpperCase()] || 'SENT';

  // tenantId was always in the job payload but this where-clause never used
  // it — the single query in the codebase that dropped tenant scoping. RLS
  // now also blocks a cross-tenant match, but the filter belongs here too.
  await prisma.message.updateMany({
    where: { waMessageId, tenantId },
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
  // Wrapped in the same AsyncLocalStorage the API's requestContext middleware
  // uses, keyed by BullMQ's own job.id — every log line emitted while this
  // job runs (across claude.service.js, whatsapp.service.js, etc., all of
  // which just call the shared logger) picks it up automatically via
  // utils/logger.js's mixin. Consistent field name (requestId) across the
  // API and the worker on purpose, so a search doesn't need to know which
  // process emitted a given line to find related ones.
  // tenantId in the store doubles as the Postgres RLS context (see
  // config/database.js). It comes from job.data, which the webhook populated
  // from the HMAC-verified waPhoneId→tenant lookup — the worker never
  // re-derives it from message content.
  (job) => requestContext.run({ requestId: job.id, tenantId: job.data?.tenantId || '' }, () => {
    if (job.name === 'inbound-message') return processInboundMessage(job);
    if (job.name === 'status-update')   return processStatusUpdate(job);
  }),
  {
    connection: redis,
    concurrency: 10,         // Process up to 10 messages simultaneously
    limiter: { max: 50, duration: 1000 }, // Max 50 jobs/second
  }
);

worker.on('completed', (job) => {
  logger.debug({ jobId: job.id, name: job.name }, 'Job completed');
});

// A job that exhausted its retries is a lead whose message will never be
// answered. Sentry alone was the only witness — the tenant's dashboard
// showed nothing, so the lead read silence and nobody followed up. Surface
// it where the humans actually look: an Activity on the lead's timeline and
// the admin's WhatsApp notification channel.
const deadLetterInboundMessage = async (job, err) => {
  const { tenantId, phone, contactName, waMessageId } = job.data || {};
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;

  const normalized = phone ? whatsappService.normalizePhone(phone) : null;
  const contact = normalized
    ? await prisma.contact.findFirst({ where: { tenantId, phone: normalized }, select: { id: true, name: true } })
    : null;
  const lead = contact
    ? await prisma.lead.findFirst({ where: { tenantId, contactId: contact.id }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    : null;

  if (lead) {
    await prisma.activity.create({
      data: {
        tenantId,
        leadId: lead.id,
        type: 'AI_ACTION',
        content: '🚨 A message from this lead could not be processed after all retries — they have NOT received a reply. Please respond manually.',
        metadata: { flag: 'message_processing_failed', waMessageId: waMessageId || null, error: String(err?.message || err).slice(0, 300) },
      },
    }).catch(() => {});
  }

  notificationService.notifyAdmin(tenant, 'needsHuman', {
    contactName: contact?.name || contactName,
    phone: normalized || phone,
    reason: 'A message from this lead failed processing after all retries — reply manually',
  });
};

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, name: job?.name, err: err.message, attempts: job?.attemptsMade }, 'Job failed');

  // BullMQ retries per queues/message.queue.js (up to 5 attempts with
  // exponential backoff) before giving up — most 'failed' events here are a
  // mid-flight retry, not an incident. Only report once retries are
  // genuinely exhausted (attemptsMade reaches the job's configured limit),
  // so Sentry shows "this lead's message never got processed" once, not up
  // to five times per real failure.
  const exhausted = job && job.attemptsMade >= (job.opts?.attempts || 1);
  if (exhausted) {
    Sentry.captureException(err, {
      tags: { jobName: job?.name },
      extra: { jobId: job?.id, attemptsMade: job?.attemptsMade },
    });

    if (job?.name === 'inbound-message' && job?.data?.tenantId) {
      // Same AsyncLocalStorage wrap as the processor so the RLS tenant
      // context is present once enforcement is on.
      requestContext.run({ requestId: `${job.id}_deadletter`, tenantId: job.data.tenantId }, () =>
        deadLetterInboundMessage(job, err).catch((e) => logger.warn({ err: e }, 'Dead-letter reporting failed'))
      );
    }
  }
});

worker.on('error', (err) => {
  logger.error({ err }, 'Worker error');
  Sentry.captureException(err);
});

// Same RLS-role verification as server.js — the worker holds its own DB
// connection and processes every tenant's messages, so it must not run on a
// bypassing role either once enforcement is switched on.
prisma.assertRlsEnforceable({ logger, fatal: env.REQUIRE_RLS_ENFORCEMENT === 'true' })
  .then((ok) => { if (!ok) process.exit(1); })
  .catch((err) => logger.warn({ err }, 'Could not verify RLS role'));

logger.info('🔄 Conversation worker started');

// One-time insights backfill: classify recent inbound messages that predate
// the sentiment/signal pipeline (idempotent — finds nothing once done).
// Delayed 30s so boot isn't competing with the queue coming online.
setTimeout(() => {
  const { runInsightsBackfill } = require('../services/insightsBackfill.service');
  runInsightsBackfill().catch((err) => logger.warn({ err }, '📊 Insights backfill failed'));
}, 30_000);

// ─────────────────────────────────────────────────────────────────────
// SCHEDULER WORKER
// ─────────────────────────────────────────────────────────────────────
// The scheduler queue had no consumer until now — scheduleFollowUp() was
// enqueuing jobs nothing ever picked up. This worker drains it and runs the
// Monday 09:00 PKT digest.
//
// concurrency 1: these are low-volume, time-based jobs; serialising them
// keeps the weekly fan-out from contending with the message worker.
const digestService = require('../services/digest.service');
const automationService = require('../services/automation.service');
const sheetsSyncService = require('../services/sheetsSync.service');

const schedulerWorker = new Worker(
  QUEUE_NAMES.SCHEDULER_QUEUE,
  (job) => requestContext.run(
    { requestId: job.id, tenantId: job.data?.tenantId || '' },
    () => {
      if (job.name === 'weekly-digest') return digestService.runWeeklyDigestForAllTenants();
      if (job.name === 'automation-tick') return automationService.runTick();
      if (job.name === 'sheets-sync-tick') return sheetsSyncService.syncAllTenants();
      if (job.name === 'sheets-sync') return sheetsSyncService.syncTenant(job.data?.tenantId);
      // 'follow-up' intentionally unhandled for now: returning cleanly drains
      // the backlog these accumulated instead of failing them in a loop.
      logger.warn({ jobName: job.name, jobId: job.id }, 'Scheduler job has no handler — draining');
      return null;
    }
  ),
  { connection: redis, concurrency: 1 }
);

schedulerWorker.on('failed', (job, err) => {
  logger.error({ err, jobId: job?.id, name: job?.name }, 'Scheduler job failed');
  Sentry.captureException(err);
});

// Idempotent — safe to call on every boot.
registerWeeklyDigest()
  .then(() => logger.info('🗓  Weekly digest scheduled — Mondays 09:00 Asia/Karachi'))
  .catch((err) => logger.warn({ err }, 'Could not register weekly digest schedule'));

registerAutomationTick()
  .then(() => logger.info(`🤖 Automation tick scheduled — every ${automationService.TICK_MINUTES} min`))
  .catch((err) => logger.warn({ err }, 'Could not register automation tick schedule'));

registerSheetsSyncTick()
  .then(() => logger.info('📊 Google Sheet lead sync scheduled — hourly'))
  .catch((err) => logger.warn({ err }, 'Could not register sheet sync schedule'));

module.exports = worker;
