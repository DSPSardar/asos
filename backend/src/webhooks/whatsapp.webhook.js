// src/webhooks/whatsapp.webhook.js
// Receives all incoming WhatsApp Cloud API events

const { Router } = require('express');
const crypto = require('crypto');
const Sentry = require('@sentry/node');
const env = require('../config/env');
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsapp.service');
const { publishInboundMessage, publishStatusUpdate } = require('../queues/message.queue');
const prisma = require('../config/database');
const redis = require('../config/redis');
const { decrypt } = require('../utils/crypto');

const router = Router();

// ── GET — WhatsApp webhook verification handshake ─────────────────────
router.get('/', async (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe') {
    // A tenant can configure its own Meta verify token from the dashboard.
    // Keep the environment token as a fallback for existing deployments.
    // Hash-then-timingSafeEqual: constant-time regardless of length, so the
    // comparison leaks nothing about the configured token.
    const tokensMatch = (a, b) => crypto.timingSafeEqual(
      crypto.createHash('sha256').update(String(a)).digest(),
      crypto.createHash('sha256').update(String(b)).digest()
    );
    let verified = Boolean(token) && tokensMatch(token, env.WHATSAPP_VERIFY_TOKEN);
    if (!verified && token) {
      const tenant = await prisma.tenant.findFirst({
        where: { waVerifyToken: token },
        select: { id: true },
      });
      verified = Boolean(tenant);
    }

    if (verified) {
      logger.info('WhatsApp webhook verified');
      return res.status(200).send(challenge);
    }
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
      logger.warn({ event: 'webhook.whatsapp.rejected', reason: 'unknown_phone_number_id', phoneNumberId }, 'No tenant found for WA phone number ID');
      return;
    }

    if (tenant.status === 'SUSPENDED') return;

    // ── 2. Verify HMAC signature ──────────────────────────────────
    // This MUST fail closed. It previously read `if (appSecret && signature)`,
    // which skipped verification entirely whenever the signature header was
    // absent — so anyone who knew a tenant's phone_number_id (it is not a
    // secret; it appears in every webhook payload) could POST a forged message
    // with no signature at all and have it processed: fabricated contacts and
    // leads, OpenAI spend on the dual-agent pipeline, and outbound WhatsApp
    // messages sent from the client's own business number.
    //
    // Note WHATSAPP_APP_SECRET defaults to 'mock-secret' in config/env.js, so
    // `appSecret` is effectively always truthy and never guarded anything.
    const signature = req.headers['x-hub-signature-256'];
    const rawSecret = tenant.waAppSecret || env.WHATSAPP_APP_SECRET;
    const appSecret = rawSecret ? (() => { try { return decrypt(rawSecret) || rawSecret; } catch { return rawSecret; } })() : null;

    // A placeholder secret cannot authenticate anything. Outside development
    // that is a misconfiguration, not a reason to accept unsigned traffic.
    const isPlaceholderSecret = !appSecret || appSecret === 'mock-secret';

    if (isPlaceholderSecret) {
      if (env.NODE_ENV === 'production') {
        logger.error(
          { event: 'webhook.whatsapp.rejected', reason: 'no_real_app_secret', tenantId: tenant.id },
          'WA webhook rejected: no real app secret configured for this tenant. ' +
          'Set the tenant waAppSecret or WHATSAPP_APP_SECRET — unsigned webhooks are never processed in production.'
        );
        return;
      }
      logger.warn({ event: 'webhook.whatsapp.signature_skipped', tenantId: tenant.id }, 'WA webhook signature check skipped — placeholder secret (non-production only)');
    } else {
      if (!signature) {
        logger.warn({ event: 'webhook.whatsapp.rejected', reason: 'missing_signature', tenantId: tenant.id }, 'WA webhook rejected: missing x-hub-signature-256 header');
        return;
      }
      if (!whatsappService.verifySignature(rawBody, signature, appSecret)) {
        logger.warn({ event: 'webhook.whatsapp.rejected', reason: 'hmac_mismatch', tenantId: tenant.id }, 'WA webhook rejected: HMAC verification failed');
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
      // If the enqueue fails, release the dedup key set above — otherwise
      // Meta's redelivery of this exact message would be dropped for 24h
      // and the lead's message silently lost.
      try {
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
      } catch (err) {
        await redis.del(dedupKey).catch(() => {});
        throw err;
      }

      logger.info({ event: 'webhook.whatsapp.accepted', tenantId: tenant.id, phone: parsed.phone, waMessageId: parsed.waMessageId }, '📨 Inbound message queued');
    }

  } catch (err) {
    logger.error({ event: 'webhook.whatsapp.error', err }, 'Error processing WA webhook');
    // Response already sent (line 47) before Meta's 5s timeout — this can
    // only report, never change what the client sees. Not covered by
    // Express's own error-handling chain since this route catches its own
    // errors rather than calling next(err).
    Sentry.captureException(err);
  }
});

module.exports = router;
