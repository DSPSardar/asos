// src/services/whatsapp.service.js
// WhatsApp Cloud API (Meta) — send messages, handle media

const axios = require('axios');
const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/crypto');
const prisma = require('../config/database');

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

// ── Determine if a tenant should use mock mode ────────────────────────
// Mock when: global env flag OR tenant has no real credentials saved

const isMockMode = (tenant) => {
  if (env.WHATSAPP_MOCK === 'true') return true;
  if (!tenant.waAccessToken || !tenant.waPhoneId) return true;
  return false;
};

// ── Send text message ─────────────────────────────────────────────────

const sendText = async (tenant, to, text) => {
  // ── Mock mode: skip Meta API, log to console ──────────────────────
  if (isMockMode(tenant)) {
    const mockId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reason = env.WHATSAPP_MOCK === 'true' ? 'global mock env' : 'no credentials saved';
    logger.info({ to, tenantId: tenant.id, mockId, reason, preview: text?.slice(0, 80) }, '[MOCK] WA message suppressed — would have been sent');
    return mockId;
  }

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

// ── Send audio message (voice note) ───────────────────────────────────
// Two-step Cloud API flow: upload the buffer to Meta's media endpoint
// (multipart/form-data — a fresh axios call, not getClient()'s JSON
// instance), then send a message referencing the returned media id.
// mimeType should be a WhatsApp-supported audio type, e.g. 'audio/mpeg'.

const sendAudio = async (tenant, to, audioBuffer, mimeType) => {
  if (isMockMode(tenant)) {
    const mockId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reason = env.WHATSAPP_MOCK === 'true' ? 'global mock env' : 'no credentials saved';
    logger.info({ to, tenantId: tenant.id, mockId, reason }, '[MOCK] WA audio message suppressed — would have been sent');
    return mockId;
  }

  try {
    const extension = mimeType.includes('ogg') ? 'ogg' : 'mp3';
    const mediaId = await uploadMedia(tenant, audioBuffer, mimeType, `voice-note.${extension}`);
    return await sendAudioByMediaId(tenant, to, mediaId);
  } catch (err) {
    const apiError = err.response?.data?.error;
    logger.error({ err: apiError || err.message, to, tenantId: tenant.id }, 'Failed to send WA audio message');
    return null;
  }
};

// ── Upload a media buffer to Meta, returning the media id ─────────────
// Standalone half of the sendAudio() flow above — used by callers that
// need to upload once and reference the media id across many sends (e.g.
// the welcome voice note, which reuses one mediaId for every new lead).

const uploadMedia = async (tenant, buffer, mimeType, filename) => {
  if (isMockMode(tenant)) {
    const mockId = `mock_media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reason = env.WHATSAPP_MOCK === 'true' ? 'global mock env' : 'no credentials saved';
    logger.info({ tenantId: tenant.id, mockId, reason, filename }, '[MOCK] WA media upload suppressed — would have been uploaded');
    return mockId;
  }

  const token = decrypt(tenant.waAccessToken) || tenant.waAccessToken;
  const baseURL = `${env.WHATSAPP_API_URL}/${tenant.waPhoneId}`;

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const res = await axios.post(`${baseURL}/media`, form, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
  });

  const mediaId = res.data?.id;
  if (!mediaId) throw new Error('Media upload returned no id');
  return mediaId;
};

// ── Send an audio message referencing an already-uploaded media id ────
// Throws on failure (unlike sendAudio/sendText) so callers that need to
// detect an expired/invalid media id and retry after a re-upload can do so.

const sendAudioByMediaId = async (tenant, to, mediaId) => {
  if (isMockMode(tenant)) {
    const mockId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reason = env.WHATSAPP_MOCK === 'true' ? 'global mock env' : 'no credentials saved';
    logger.info({ to, tenantId: tenant.id, mockId, reason, mediaId }, '[MOCK] WA audio message suppressed — would have been sent');
    return mockId;
  }

  const client = getClient(tenant);
  const res = await client.post('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(to),
    type: 'audio',
    audio: { id: mediaId },
  });

  logger.info({ to, tenantId: tenant.id, waMessageId: res.data?.messages?.[0]?.id, mediaId }, 'WA audio message sent');
  return res.data?.messages?.[0]?.id;
};

// ── Send template message ─────────────────────────────────────────────

const sendTemplate = async (tenant, to, templateName, languageCode = 'pt_BR', components = []) => {
  if (isMockMode(tenant)) {
    const mockId = `mock_tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({ to, tenantId: tenant.id, templateName, mockId }, '[MOCK] WA template suppressed — would have been sent');
    return mockId;
  }

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

// Resolves the temporary signed URL via getMediaUrl(), then fetches the
// actual bytes — Meta's media URLs require the same bearer token as the
// rest of the Graph API, so this is a second authenticated request, not a
// plain public download.

const downloadMedia = async (tenant, mediaId) => {
  const url = await getMediaUrl(tenant, mediaId);
  if (!url) return null;

  try {
    const token = decrypt(tenant.waAccessToken) || tenant.waAccessToken;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 20000,
    });

    return {
      buffer: Buffer.from(res.data),
      mimeType: res.headers['content-type'] || 'application/octet-stream',
    };
  } catch (err) {
    logger.warn({ err: err.message, mediaId }, 'Failed to download WA media');
    return null;
  }
};

// ── Persist inbound media permanently, in Postgres ─────────────────────
// Meta's media URL from getMediaUrl() is a short-lived signed link (good for
// minutes), so it can never be stored as-is on a message row — by the time
// anyone opens the conversation it would already be expired. This downloads
// the bytes once via downloadMedia() and stores them as a row in
// InboundMedia rather than a file on local disk.
//
// Why the database and not a file: this function runs inside the
// asos-worker container, but media is served by the separate asos (API)
// container — Railway gives each its own non-persistent filesystem with no
// shared volume, so a file written here would be invisible to (and would
// not outlive a redeploy of) the service that actually serves it. Postgres
// is the one thing every service instance already reads and writes, and
// rows survive redeploys the same way every other table here does.
//
// Returns { url, buffer, mimeType } on success — url is `/media/<id>`,
// served by the GET /media/:id route in app.js. buffer/mimeType are
// returned alongside so a second caller (e.g. payment-proof image
// classification) never triggers a second Meta round trip for the same
// media id. Returns null on failure — callers must treat null as "no media
// persisted" and fall back to text-only, never as a reason to throw and
// drop the inbound message.

const saveInboundMedia = async (tenant, mediaId) => {
  const media = await downloadMedia(tenant, mediaId);
  if (!media) return null;

  try {
    const sha256 = crypto.createHash('sha256').update(media.buffer).digest('hex');
    const row = await prisma.inboundMedia.create({
      data: {
        tenantId: tenant.id,
        mimeType: media.mimeType || 'application/octet-stream',
        data: media.buffer,
        sha256,
      },
      select: { id: true },
    });

    const url = `/media/${row.id}`;
    logger.info({ tenantId: tenant.id, mediaId, mimeType: media.mimeType, bytes: media.buffer.length, mediaRowId: row.id }, 'Inbound WA media persisted to Postgres');
    return { url, buffer: media.buffer, mimeType: media.mimeType, mediaRowId: row.id, sha256 };
  } catch (err) {
    logger.warn({ err: err.message, tenantId: tenant.id, mediaId }, 'Failed to persist inbound WA media to database');
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

  // Reject anything that is not exactly a SHA-256 hex digest before comparing.
  // The previous version padded `received` up to the expected length and went
  // straight to timingSafeEqual, which throws RangeError on a buffer-length
  // mismatch — a longer signature was never truncated by padEnd, and any
  // non-hex character makes Buffer.from(..., 'hex') stop early and return a
  // short buffer. Both threw instead of returning false.
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(received, 'hex')
  );
};

// ── Verify credentials against Meta Graph API ─────────────────────────
// Returns { ok, phoneNumber, verifiedName, qualityRating, error }

const verifyCredentials = async (tenant) => {
  const phoneId = tenant.waPhoneId;
  const rawToken = tenant.waAccessToken;

  if (!phoneId || !rawToken) {
    return { ok: false, error: 'Phone Number ID or Access Token not configured' };
  }

  const token = (() => { try { return decrypt(rawToken) || rawToken; } catch { return rawToken; } })();

  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${phoneId}`,
      {
        params: { access_token: token },
        timeout: 10000,
      }
    );
    const d = res.data;
    return {
      ok:            true,
      phoneNumber:   d.display_phone_number,
      verifiedName:  d.verified_name,
      qualityRating: d.quality_rating,
      status:        d.code_verification_status,
      throughput:    d.throughput?.level,
    };
  } catch (err) {
    const metaErr = err.response?.data?.error;
    return {
      ok:      false,
      error:   metaErr?.message || err.message,
      code:    metaErr?.code,
      subcode: metaErr?.error_subcode,
      type:    metaErr?.type,
    };
  }
};

// ── Normalize phone to E.164 ──────────────────────────────────────────

const normalizePhone = (phone) => {
  return phone.replace(/\D/g, '').replace(/^0+/, '');
};

module.exports = {
  sendText,
  sendAudio,
  uploadMedia,
  sendAudioByMediaId,
  sendTemplate,
  sendButtons,
  markAsRead,
  getMediaUrl,
  downloadMedia,
  saveInboundMedia,
  parseInboundMessage,
  verifySignature,
  verifyCredentials,
  isMockMode,
  normalizePhone,
};
