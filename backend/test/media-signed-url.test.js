// test/media-signed-url.test.js
//
// /media/:id used to be fetchable by anyone holding the bare UUID — and the
// table holds payment-proof screenshots. The route now refuses anything
// without a valid, unexpired HMAC signature; getConversation() signs each
// mediaUrl at response time. This guards the signing/verification contract
// itself (utils/mediaToken.js), independent of the Postgres lookup.
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-xx';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-test-refresh-test-refresh';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/test';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signMediaUrl, verifyMediaSignature } = require('../src/utils/mediaToken');

const parts = (url) => {
  const m = url.match(/^\/media\/([^?]+)\?e=(\d+)&s=([0-9a-f]{64})$/);
  assert.ok(m, `signed URL has the expected shape: ${url}`);
  return { id: m[1], e: m[2], s: m[3] };
};

test('a freshly signed URL verifies', () => {
  const { id, e, s } = parts(signMediaUrl('11111111-2222-3333-4444-555555555555'));
  assert.equal(verifyMediaSignature(id, e, s), true);
});

test('bare UUID with no signature is refused', () => {
  assert.equal(verifyMediaSignature('11111111-2222-3333-4444-555555555555', undefined, undefined), false);
});

test('signature for one media id does not open another', () => {
  const { e, s } = parts(signMediaUrl('media-a'));
  assert.equal(verifyMediaSignature('media-b', e, s), false);
});

test('tampering with the expiry invalidates the signature', () => {
  const { id, e, s } = parts(signMediaUrl('media-c'));
  assert.equal(verifyMediaSignature(id, String(Number(e) + 999999), s), false);
});

test('an expired link is refused even with an otherwise valid signature shape', () => {
  const { id, s } = parts(signMediaUrl('media-d'));
  assert.equal(verifyMediaSignature(id, '1000', s), false);
});

test('malformed signature values return false, never throw', () => {
  const { id, e } = parts(signMediaUrl('media-e'));
  for (const bad of ['zz', '', null, 'sha256=abc', 'f'.repeat(63), 'f'.repeat(65)]) {
    assert.equal(verifyMediaSignature(id, e, bad), false);
  }
  assert.equal(verifyMediaSignature(id, 'not-a-number', 'f'.repeat(64)), false);
});
