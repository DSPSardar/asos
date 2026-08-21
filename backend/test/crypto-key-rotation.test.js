// test/crypto-key-rotation.test.js
//
// utils/crypto.js used to derive its AES key from JWT_SECRET (with a public
// string fallback) — rotating the JWT secret bricked every stored WhatsApp
// credential. Now ENCRYPTION_KEY is the primary key and legacy ciphertext
// written under the JWT_SECRET-derived key still decrypts, so the migration
// (set key → reencrypt-credentials.js) is zero-downtime.
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-xx';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-test-refresh-test-refresh';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/test';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.ENCRYPTION_KEY = 'dedicated-encryption-key-for-tests-0001';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('crypto');
const { encrypt, decrypt, isLegacyCiphertext } = require('../src/utils/crypto');

// Reproduce the pre-ENCRYPTION_KEY on-disk format: AES-256-GCM under the
// JWT_SECRET-derived key.
const legacyEncrypt = (text) => {
  const key = nodeCrypto.scryptSync(process.env.JWT_SECRET, 'asos-salt', 32);
  const iv = nodeCrypto.randomBytes(16);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
};

test('roundtrip under the dedicated ENCRYPTION_KEY', () => {
  const secret = 'EAAG-whatsapp-access-token-xyz';
  const stored = encrypt(secret);
  assert.notEqual(stored, secret);
  assert.equal(decrypt(stored), secret);
  assert.equal(isLegacyCiphertext(stored), false);
});

test('ciphertext written under the old JWT_SECRET-derived key still decrypts', () => {
  const stored = legacyEncrypt('legacy-wa-app-secret');
  assert.equal(decrypt(stored), 'legacy-wa-app-secret');
  assert.equal(isLegacyCiphertext(stored), true, 'flagged for reencrypt-credentials.js');
});

test('garbage and tampered ciphertext return null, never throw', () => {
  assert.equal(decrypt(null), null);
  assert.equal(decrypt('not-encrypted-at-all'), null);
  const stored = encrypt('secret');
  const [iv, tag, data] = stored.split(':');
  const flipped = data.slice(0, -2) + (data.endsWith('00') ? '11' : '00');
  assert.equal(decrypt(`${iv}:${tag}:${flipped}`), null);
  assert.equal(isLegacyCiphertext('not-encrypted-at-all'), false);
});
