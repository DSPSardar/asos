// src/services/whatsapp.service.js
// WhatsApp Cloud API (Meta) — send messages, handle media

const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/crypto');

// ── Get axios instance for a specific tenant ──────────────────────────

const getClient = (tenant) => {
  const token = decrypt(tenant.waAccessToken) || tenant.waAccessToken;
  return axios.create({
    baseURL: `${env.WHATSAPP_API_URL}/${tenant.waPhoneId}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
};

// ── Send text message ─────────────────────────────────────────────────

const sendText = async (tenant, to, text) => {
  try {
    const client = getClient(tenant);
    const res = await client.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizePhone(to),
      type: 'text',
      text: { body: text, preview_url: false },
    });

    logger.info({ to, tenantId: tenant.id, waMessageId: res.data?.messages?.[0]?.id }, 'WA text message sent');
    return res.data?.messages?.[0]?.id;

  } catch (err) {
    const apiError = err.response?.data?.error;
    logger.error({ err: apiError || err.message, to, tenantId: tenant.id }, 'Failed to send WA message');
    throw new Error(apiError?.message || 'Failed to send WhatsApp message');
  }
};

// ── Send template message ─────────────────────────────────────────────

const sendTemplate = async (tenant, to, templateName, languageCode = 'pt_BR', components = []) => {
  try {
    const client = getClient(tenant);
    const res = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to: normalizePhone(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    });

    logger.info({ to, templateName, tenantId: tenant.id }, 'WA template sent');
    return res.data?.messages?.[0]?.id;

  } catch (err) {
    logger.error({ err: err.response?.data, to, templateName }, 'Failed to send WA template');
    throw new Error('Failed to send WhatsApp template');
  }
};

// ── Send interactive message (buttons) ───────────────────────────────

const sendButtons = async (tenant, to, bodyText, buttons) => {
  try {
    const client = getClient(tenant);
    const res = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to: normalizePhone(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map((btn, i) => ({
            type: 'reply',
            reply: { id: btn.id || `btn_${i}`, title: btn.title.slice(0, 20) },
          })),
        },
      },
    });

    return res.data?.messages?.[0]?.id;
  } catch (err) {
    logger.error({ err: err.response?.data, to }, 'Failed to send WA buttons');
    // Fallback to plain text if interactive fails
    return sendText(tenant, to, bodyText);
  }
};

// ── Mark message as read ──────────────────────────────────────────────

const markAsRead = async (tenant, waMessageId) => {
  try {
    const client = getClient(tenant);
    await client.post('/messages', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: waMessageId,
    });
  } catch (err) {
    // Non-critical — don't throw
    logger.warn({ err: err.message, waMessageId }, 'Failed to mark WA message as read');
  }
};

// ── Download media from WA ────────────────────────────────────────────

const getMediaUrl = async (tenant, mediaId) => {
  try {
    const token = decrypt(tenant.waAccessToken) || tenant.waAccessToken;
    const res = await axios.get(`${env.WHATSAPP_API_URL}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data?.url;
  } catch (err) {
    logger.warn({ err: err.message, mediaId }, 'Failed to get WA media URL');
    return null;
  }
};

// ── Parse incoming webhook message ───────────────────────────────────

const parseInboundMessage = (webhookBody) => {
  try {
    const entry = webhookBody?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value) return null;

    // Message status update (delivered, read, failed)
    if (value.statuses?.length) {
      return {
        type: 'status',
        waMessageId: value.statuses[0].id,
        status: value.statuses[0].status.toUpperCase(),
        phone: value.statuses[0].recipient_id,
        timestamp: value.statuses[0].timestamp,
      };
    }

    // Inbound message
    if (value.messages?.length) {
      const msg = value.messages[0];
      const contact = value.contacts?.[0];

      return {
        type: 'message',
        waMessageId: msg.id,
        phone: msg.from,
        contactName: contact?.profile?.name || null,
        messageType: msg.type,
        content: extractMessageContent(msg),
        mediaId: msg[msg.type]?.id || null,
        timestamp: msg.timestamp,
        // Extract ad attribution if present (Click-to-WA)
        referral: msg.referral || null,
      };
    }

    return null;
  } catch (err) {
    logger.error({ err }, 'Failed to parse WA webhook body');
    return null;
  }
};

// ── Extract text content from any message type ────────────────────────

const extractMessageContent = (msg) => {
  switch (msg.type) {
    case 'text':      return msg.text?.body || '';
    case 'image':     return msg.image?.caption || '[Image]';
    case 'audio':     return '[Audio message]';
    case 'video':     return msg.video?.caption || '[Video]';
    case 'document':  return msg.document?.filename || '[Document]';
    case 'location':  return `[Location: ${msg.location?.latitude},${msg.location?.longitude}]`;
    case 'button':    return msg.button?.text || '[Button reply]';
    case 'interactive': return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[Interactive]';
    default:          return `[${msg.type}]`;
  }
};

// ── Verify webhook signature ──────────────────────────────────────────

const verifySignature = (rawBody, signature, appSecret) => {
  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const received = signature?.replace('sha256=', '') || '';
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(received.padEnd(expected.length, '0'), 'hex')
  );
};

// ── Normalize phone to E.164 ──────────────────────────────────────────

const normalizePhone = (phone) => {
  return phone.replace(/\D/g, '').replace(/^0+/, '');
};

module.exports = {
  sendText,
  sendTemplate,
  sendButtons,
  markAsRead,
  getMediaUrl,
  parseInboundMessage,
  verifySignature,
  normalizePhone,
};
