// test/message-type-mapping.test.js
//
// Regression guard for the bug reported in production: a lead reacted to
// a message with an emoji, WhatsApp sent an inbound event with
// msg.type === 'reaction', and the worker wrote 'REACTION' straight into
// the database's MessageType column — which doesn't have that value.
// Prisma threw "Invalid value for argument `type`. Expected MessageType.",
// the BullMQ job failed, every retry hit the same deterministic error, and
// the message (and the lead's expectation of a reply) was dropped for
// good. Confirmed via Railway logs: repeated "Job failed" bursts since
// 2026-08-11, with the exact Prisma error visible in the 06:01-06:06 UTC
// burst on 2026-08-14.
//
// This tests the real toDbMessageType() (not a reimplementation) against
// every value actually observed in WhatsApp's webhook payloads, cross-
// checked against the live MessageType enum in schema.prisma so a future
// schema change that adds/removes an enum value is caught here rather than
// rediscovered as another dropped conversation.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { toDbMessageType, KNOWN_MESSAGE_TYPES } = require('../src/utils/messageType');

test('KNOWN_MESSAGE_TYPES matches the live MessageType enum in schema.prisma', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  const match = schema.match(/enum MessageType\s*{([^}]+)}/);
  assert.ok(match, 'schema.prisma should define a MessageType enum');

  const enumValues = new Set(
    match[1].split('\n').map((line) => line.trim()).filter(Boolean)
  );

  assert.deepEqual(
    [...KNOWN_MESSAGE_TYPES].sort(),
    [...enumValues].sort(),
    'the whitelist in messageType.js has drifted from the actual Prisma enum — a value either got added to the schema without being allow-listed here, or vice versa'
  );
});

test('the exact reported incident: a reaction event maps to TEXT instead of crashing', () => {
  assert.equal(toDbMessageType('reaction'), 'TEXT');
});

test('other WhatsApp event types missing from the enum also fall back to TEXT, not just reactions', () => {
  // These are all real msg.type values WhatsApp's webhook can send that
  // have no corresponding MessageType enum value — the same crash was
  // waiting to happen for any of them, not only reactions.
  for (const type of ['video', 'location', 'button', 'sticker', 'contacts', 'order', 'system', 'unknown']) {
    assert.equal(toDbMessageType(type), 'TEXT', `${type} should fall back to TEXT, not crash Prisma`);
  }
});

test('known, already-handled types pass through unchanged', () => {
  assert.equal(toDbMessageType('text'), 'TEXT');
  assert.equal(toDbMessageType('image'), 'IMAGE');
  assert.equal(toDbMessageType('audio'), 'AUDIO');
  assert.equal(toDbMessageType('document'), 'DOCUMENT');
  assert.equal(toDbMessageType('interactive'), 'INTERACTIVE');
});

test('is case-insensitive and null-safe (webhook payloads are not always well-formed)', () => {
  assert.equal(toDbMessageType('TEXT'), 'TEXT');
  assert.equal(toDbMessageType('Image'), 'IMAGE');
  assert.equal(toDbMessageType(null), 'TEXT');
  assert.equal(toDbMessageType(undefined), 'TEXT');
  assert.equal(toDbMessageType(''), 'TEXT');
});
