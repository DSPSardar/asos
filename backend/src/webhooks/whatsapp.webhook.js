// src/webhooks/whatsapp.webhook.js
// Receives all incoming WhatsApp Cloud API events

const { Router } = require('express');
const env = require('../config/env');
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsapp.service');
const { publishInboundMessage, publishStatusUpdate } = require('../queues/message.queue');
const prisma = require('../config/database');
const redis = require('../config/redis');

const router = Router();

// ── GET — WhatsApp webhook verification handshake ─────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }

  logger.warn({ mode, token }, 'WhatsApp webhook verification failed');
  return res.status(403).json({ error: 'Verification failed' });
});

// ── POST — Receive incoming messages and status updates ───────────────
router.post('/', async (req, res) => {
  // Respond 200 immediately — Meta requires < 5s response or retries
  res.status(200).json({ status: 'received' });

  try {
    const rawBody = req.body;
    const body = JSON.parse(rawBody.toString());

    // ── 1. Identify tenant from phone number ID ───────────────────
    const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    if (!phoneNumberId) return;

    const tenant = await prisma.tenant.findFirst({
      where: { waPhoneId: phoneNumberId },
      select: { id: true, waAppSecret: true, status: true },
    });

    if (!tenant) {
      logger.warn({ phoneNumberId }, 'No tenant found for WA phone number ID');
      return;
    }

    if (tenant.status === 'SUSPENDED') return;

    // ── 2. Verify HMAC signature ──────────────────────────────────
    const signature = req.headers['x-hub-signature-256'];
    const appSecret = tenant.waAppSecret || env.WHATSAPP_APP_SECRET;

    if (appSecret && signature) {
      const valid = whatsappService.verifySignature(rawBody, signature, appSecret);
      if (!valid) {
        logger.warn({ tenantId: tenant.id }, 'WA webhook HMAC verification failed');
        return;
      }
    }

    // ── 3. Parse the message ──────────────────────────────────────
    const parsed = whatsappService.parseInboundMessage(body);
    if (!parsed) return;

    // ── 4. Route by event type ────────────────────────────────────
    if (parsed.type === 'status') {
      // Status update: sent → delivered → read → failed
      await publishStatusUpdate({
        waMessageId: parsed.waMessageId,
        status: parsed.status,
        phone: parsed.phone,
        tenantId: tenant.id,
      });
      return;
    }

    if (parsed.type === 'message') {
      // ── 5. Dedup check via Redis ──────────────────────────────
      const dedupKey = `asos:dedup:${parsed.waMessageId}`;
      const alreadySeen = await redis.set(dedupKey, '1', 'EX', 86400, 'NX');
      if (!alreadySeen) {
        logger.debug({ waMessageId: parsed.waMessageId }, 'Duplicate WA message — skipped');
        return;
      }

      // ── 6. Publish to message queue ───────────────────────────
      await publishInboundMessage({
        tenantId: tenant.id,
        phone: parsed.phone,
        contactName: parsed.contactName,
        content: parsed.content,
        waMessageId: parsed.waMessageId,
        messageType: parsed.messageType,
        referral: parsed.referral,
        mediaId: parsed.mediaId,
        timestamp: parsed.timestamp,
      });

      logger.info({ tenantId: tenant.id, phone: parsed.phone, waMessageId: parsed.waMessageId }, '📨 Inbound message queued');
    }

  } catch (err) {
    logger.error({ err }, 'Error processing WA webhook');
  }
});

module.exports = router;
