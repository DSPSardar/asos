// src/utils/mediaToken.js
//
// Short-lived HMAC signatures for /media/:id. The route can't require an
// Authorization header (an <img> tag can't send one), so instead the API
// signs each media URL at response time and the route refuses anything
// unsigned or expired. This closes the previous model where any inbound
// WhatsApp image — payment screenshots included — was fetchable forever by
// anyone holding the bare UUID.
//
// Key is derived from JWT_SECRET with its own salt (distinct from
// utils/crypto.js's encryption salt). Signatures embed the expiry, so
// rotating JWT_SECRET simply invalidates outstanding links — the dashboard
// re-fetches the conversation and gets fresh ones.

const crypto = require('crypto');
const env = require('../config/env');

const KEY = crypto.scryptSync(env.JWT_SECRET, 'asos-media-salt', 32);
const DEFAULT_TTL_SECONDS = 60 * 60; // dashboard re-signs on every conversation fetch

const hmac = (payload) => crypto.createHmac('sha256', KEY).update(payload).digest('hex');

const signMediaUrl = (mediaId, ttlSeconds = DEFAULT_TTL_SECONDS) => {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/media/${mediaId}?e=${exp}&s=${hmac(`${mediaId}.${exp}`)}`;
};

const verifyMediaSignature = (mediaId, exp, signature) => {
  if (!/^\d{1,12}$/.test(String(exp || ''))) return false;
  if (parseInt(exp, 10) < Math.floor(Date.now() / 1000)) return false;

  const expected = hmac(`${mediaId}.${exp}`);
  const received = String(signature || '');
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
};

module.exports = { signMediaUrl, verifyMediaSignature };
