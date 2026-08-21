// src/utils/crypto.js
// Encrypt/decrypt tenant credentials (WA tokens, etc.)
//
// Key material: ENCRYPTION_KEY is the dedicated secret for credential
// encryption. Historically the key was derived from JWT_SECRET (with a
// public string fallback), which coupled two unrelated secrets — rotating
// the JWT signing secret silently bricked every stored WhatsApp credential.
// Migration path, zero downtime:
//   1. Deploy with ENCRYPTION_KEY unset → behavior identical to before
//      (JWT_SECRET-derived key, minus the public fallback).
//   2. Set ENCRYPTION_KEY (any string ≥32 chars). New writes encrypt with
//      it; decrypt() still falls back to the legacy key for old ciphertext.
//   3. Run scripts/reencrypt-credentials.js once to rewrite stored
//      credentials under the new key. After that, JWT_SECRET can rotate
//      freely.

const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';

// env.js guarantees JWT_SECRET (min 32 chars) — the old public
// 'fallback-secret-change-me' fallback is gone on purpose: a well-known
// key is indistinguishable from plaintext.
const LEGACY_KEY = crypto.scryptSync(env.JWT_SECRET, 'asos-salt', 32);
const PRIMARY_KEY = env.ENCRYPTION_KEY
  ? crypto.scryptSync(env.ENCRYPTION_KEY, 'asos-salt', 32)
  : LEGACY_KEY;

const encrypt = (text) => {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, PRIMARY_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

const decryptWithKey = (encryptedText, key) => {
  const [ivHex, tagHex, dataHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
};

const decrypt = (encryptedText) => {
  if (!encryptedText) return null;
  try {
    return decryptWithKey(encryptedText, PRIMARY_KEY);
  } catch {
    // Ciphertext written before ENCRYPTION_KEY was introduced. GCM's auth
    // tag makes a wrong-key attempt fail loudly, so this fallback can never
    // return garbage — it either decrypts under the legacy key or is null.
    if (PRIMARY_KEY !== LEGACY_KEY) {
      try {
        return decryptWithKey(encryptedText, LEGACY_KEY);
      } catch { /* fall through */ }
    }
    return null;
  }
};

// True when the ciphertext only opens under the legacy JWT_SECRET-derived
// key — i.e. reencrypt-credentials.js still needs to rewrite it.
const isLegacyCiphertext = (encryptedText) => {
  if (!encryptedText || PRIMARY_KEY === LEGACY_KEY) return false;
  try {
    decryptWithKey(encryptedText, PRIMARY_KEY);
    return false;
  } catch {
    try {
      decryptWithKey(encryptedText, LEGACY_KEY);
      return true;
    } catch {
      return false;
    }
  }
};

const hashPhone = (phone) => {
  return crypto.createHash('sha256').update(phone.replace(/\D/g, '')).digest('hex');
};

module.exports = { encrypt, decrypt, isLegacyCiphertext, hashPhone };
