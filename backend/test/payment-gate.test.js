// test/payment-gate.test.js
//
// Pins the "screenshot → login link" gap fix (2026-09-27). Observed in
// production: a student sent a receipt at 23:59 PKT, got the ack, wrote again
// at 00:02 and hit "AI disabled — delivered to agent inbox only". Nothing
// went back. Even after the human confirmed, the login only went out by
// email, and a contact with no email was never enrolled at all.
//
// The gate itself (human verifies, won means paid) is untouched. These tests
// pin that the student is never silent while waiting, that an email sent on
// WhatsApp is captured, that a verified-but-emailless student is asked for
// one and enrolled the moment they reply, and that every other AI-off thread
// is left alone.
'use strict';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';
process.env.MASTERY_ENROL_URL = 'https://example.test/api/mastery/enrol';
process.env.MASTERY_ENROL_SECRET = 'test-secret';

const path = require('path');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { installFakePrisma } = require('./_fakePrisma');

const db = installFakePrisma();

// outbound.service pulls in WhatsApp + ElevenLabs; replace it with a recorder.
const sent = [];
const outboundPath = path.resolve(__dirname, '../src/services/outbound.service.js');
require.cache[outboundPath] = { id: outboundPath, filename: outboundPath, loaded: true, exports: {
  sendAndSaveReply: async ({ content, conversation, phone }) => { sent.push({ content, conversationId: conversation.id, phone }); return { sent: true }; },
} };

const enrolCalls = [];
global.fetch = async (url, opts) => { enrolCalls.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({}) }; };

const gate = require('../src/services/paymentGate.service');
const redis = require('../src/config/redis');

const T = 'tenant-1';
let tenant, contact, lead, conversation;

beforeEach(async () => {
  sent.length = 0; enrolCalls.length = 0; redis._store.clear();
  for (const m of ['tenant', 'contact', 'lead', 'conversation', 'activity', 'message']) db._tables[m].length = 0;
  tenant = await db.tenant.create({ data: { id: T, settings: {} } });
  contact = await db.contact.create({ data: { id: 'c1', tenantId: T, phone: '923001234567', email: null } });
  lead = await db.lead.create({ data: { id: 'l1', tenantId: T, contactId: 'c1', product: 'MASTERY', stage: 'PROPOSED' } });
  conversation = await db.conversation.create({ data: { id: 'cv1', tenantId: T, leadId: 'l1', contactId: 'c1',
    aiEnabled: false, status: 'PENDING_VERIFICATION', paymentProofDetected: true, lastMessageAt: new Date() } });
});

const inbound = (content, over = {}) => gate.handleInboundWhileGated({
  tenant, tenantId: T, conversation, lead, contact, content, phone: contact.phone, ...over,
});

test('ack asks a Mastery lead with no email for one; not when it is on file', () => {
  assert.match(gate.emailRequestForAck({ tenant, lead, contact }), /email/i);
  assert.equal(gate.emailRequestForAck({ tenant, lead, contact: { ...contact, email: 'a@b.co' } }), '');
  assert.equal(gate.emailRequestForAck({ tenant, lead: { ...lead, product: 'BOOTCAMP' }, contact }), '');
});

test('student writing while pending gets a holding reply — once per window', async () => {
  assert.equal(await inbound('link kab milega?'), true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /verification/i);
  assert.match(sent[0].content, /email/i, 'no email on file → the hold also asks for it');
  assert.equal(await inbound('??'), true, 'still handled (no silence, no inbox-only fallthrough)');
  assert.equal(sent.length, 1, 'second nudge inside the window is not re-sent');
});

test('an email sent while pending is captured and acknowledged', async () => {
  assert.equal(await inbound('my email is Student@Example.com'), true);
  assert.equal((await db.contact.findUnique({ where: { id: 'c1' } })).email, 'student@example.com');
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /student@example\.com/);
  assert.equal(enrolCalls.length, 0, 'not verified yet — must not enrol');
});

test('verified Mastery student with no email: reply with email → enrolled + login sent', async () => {
  lead = await db.lead.update({ where: { id: 'l1' }, data: { stage: 'CLOSED_WON', enrollmentFee: 28000, currency: 'PKR' } });
  await db.conversation.update({ where: { id: 'cv1' }, data: { status: 'CLOSED' } });
  assert.equal(await inbound('student@example.com'), true);
  assert.equal(enrolCalls.length, 1);
  assert.equal(enrolCalls[0].email, 'student@example.com');
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /digitalservicesprogram\.com\/app/);
});

test('every other AI-off thread is left to the agent inbox', async () => {
  const other = await db.conversation.create({ data: { id: 'cv2', tenantId: T, leadId: 'l1', contactId: 'c1',
    aiEnabled: false, status: 'HUMAN_TAKEOVER', paymentProofDetected: false } });
  assert.equal(await inbound('Refund', { conversation: other }), false);
  assert.equal(sent.length, 0);
});

test('enrol path with email on file sends the login on WhatsApp', async () => {
  await db.contact.update({ where: { id: 'c1' }, data: { email: 'x@y.co' } });
  await db.lead.update({ where: { id: 'l1' }, data: { stage: 'CLOSED_WON' } });
  const r = await require('../src/services/mastery.service').enrolIfMastery({ tenantId: T, leadId: 'l1' });
  assert.deepEqual(r, { ok: true, loginSent: true });
  assert.match(sent[0].content, /x@y\.co/);
});

test('enrol path with no email asks on WhatsApp instead of going quiet', async () => {
  await db.lead.update({ where: { id: 'l1' }, data: { stage: 'CLOSED_WON' } });
  const r = await require('../src/services/mastery.service').enrolIfMastery({ tenantId: T, leadId: 'l1' });
  assert.equal(r.error, 'missing_email');
  await new Promise((r2) => setImmediate(r2));
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /email/i);
});
