// src/services/meta.service.js
// Meta Conversions API (CAPI) — server-side attribution events

const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const { hashPhone } = require('../utils/crypto');

// ── Fire a server-side event to Meta CAPI ────────────────────────────

const sendEvent = async ({ tenant, eventName, phone, leadId, value, currency = 'BRL', customData = {} }) => {
  if (!tenant.metaPixelId || !tenant.metaAccessToken) {
    logger.warn({ tenantId: tenant.id }, 'Meta CAPI not configured — skipping event');
    return null;
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = `${leadId}_${eventName}_${eventTime}`;

  const payload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,        // Dedup with browser pixel events
      action_source: 'other',   // Originated from WhatsApp
      user_data: {
        ph: [hashPhone(phone)], // SHA-256 hashed phone for matching
      },
      custom_data: {
        currency,
        value: value || 0,
        lead_id: leadId,
        ...customData,
      },
    }],
    // Test event code (remove in production)
    ...(env.NODE_ENV === 'development' && { test_event_code: 'TEST12345' }),
  };

  try {
    const url = `${env.META_API_URL}/${env.META_API_VERSION}/${tenant.metaPixelId}/events`;
    const res = await axios.post(url, payload, {
      params: { access_token: tenant.metaAccessToken },
      timeout: 10000,
    });

    logger.info({ tenantId: tenant.id, eventName, eventId, leadId }, 'Meta CAPI event sent');
    return { eventId, response: res.data };

  } catch (err) {
    logger.error({ err: err.response?.data || err.message, tenantId: tenant.id, eventName }, 'Meta CAPI event failed');
    return null; // Non-fatal — don't break the conversation flow
  }
};

// ── Convenience event wrappers ────────────────────────────────────────

const trackLead = (tenant, phone, leadId) =>
  sendEvent({ tenant, eventName: 'Lead', phone, leadId });

const trackQualified = (tenant, phone, leadId) =>
  sendEvent({ tenant, eventName: 'CompleteRegistration', phone, leadId });

const trackPurchase = (tenant, phone, leadId, value, currency) =>
  sendEvent({ tenant, eventName: 'Purchase', phone, leadId, value, currency });

const trackContactInitiated = (tenant, phone, leadId) =>
  sendEvent({ tenant, eventName: 'Contact', phone, leadId });

module.exports = { sendEvent, trackLead, trackQualified, trackPurchase, trackContactInitiated };
