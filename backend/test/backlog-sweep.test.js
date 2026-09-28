// test/backlog-sweep.test.js
//
// Item 0b — the sweep's pure classifier: what gets answered automatically,
// what stays flagged for a human, and which reply mode applies.
'use strict';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakePrisma } = require('./_fakePrisma');
const db = installFakePrisma();
const sweep = require('../src/services/backlogSweep.service');

const now = new Date('2026-09-13T12:00:00Z');
const ago = (min) => new Date(now.getTime() - min * 60_000);
const inbound = (content, min) => ({ id: 'm1', direction: 'INBOUND', content, sentAt: ago(min) });
const aiConv = (over = {}) => ({ id: 'c1', status: 'AI_HANDLING', aiEnabled: true, ...over });
const humanConv = (over = {}) => ({ id: 'c2', status: 'HUMAN_TAKEOVER', aiEnabled: false, ...over });

test('we spoke last → nothing to do', () => {
  const v = sweep.classifyThread({ conversation: aiConv(), lead: { stage: 'QUALIFYING' }, last: { direction: 'OUTBOUND', sentAt: ago(600) }, now });
  assert.deepEqual(v, { action: 'skip', reason: 'we_spoke_last' });
});

test('unanswered for 30+ minutes on an AI thread → reply; younger than that → wait for the worker', () => {
  assert.equal(sweep.classifyThread({ conversation: aiConv(), lead: { stage: 'QUALIFYING' }, last: inbound('fee kya hai', 45), now }).action, 'reply');
  assert.equal(sweep.classifyThread({ conversation: aiConv(), lead: { stage: 'QUALIFYING' }, last: inbound('fee kya hai', 10), now }).reason, 'too_recent');
});

test('a thread a rule handed to a human gets 2 hours, then the AI answers anyway', () => {
  const lead = { stage: 'DIAGNOSED' };
  assert.equal(sweep.classifyThread({ conversation: humanConv(), lead, last: inbound('kab start hoga?', 90), now }).reason, 'human_grace');
  const v = sweep.classifyThread({ conversation: humanConv(), lead, last: inbound('kab start hoga?', 121), now });
  assert.equal(v.action, 'reply');
  assert.equal(v.reason, 'human_grace_expired');
  assert.equal(v.humanHeld, true);
});

test('refund / legal / human-request threads are never answered — flagged instead', () => {
  for (const [m, kind] of [['I want a refund', 'refund_dispute'], ['main FBR mein complaint karonga', 'complaint_legal'], ['Sardar se baat karwao', 'human_requested']]) {
    const v = sweep.classifyThread({ conversation: humanConv(), lead: { stage: 'PROPOSED' }, last: inbound(m, 60 * 24 * 5), now });
    assert.equal(v.action, 'skip');
    assert.equal(v.flagged, kind, m);
  }
});

test('categories: enrolled student / payment-pending / sales, and the 24h window decides text vs template', () => {
  const enrolled = sweep.classifyThread({ conversation: aiConv(), lead: { stage: 'CLOSED_WON', product: 'MASTERY' }, last: inbound('login nahi ho raha', 60), now });
  assert.equal(enrolled.category, 'enrolled');
  assert.equal(enrolled.insideWindow, true);

  const proof = sweep.classifyThread({ conversation: humanConv({ status: 'PENDING_VERIFICATION', paymentProofDetected: true }), lead: { stage: 'DIAGNOSED' }, last: inbound('[Image]', 60 * 30), now });
  assert.equal(proof.category, 'payment_pending');
  assert.equal(proof.insideWindow, false, '30h old → template');

  const proposed = sweep.classifyThread({ conversation: aiConv(), lead: { stage: 'PROPOSED' }, last: inbound('account number?', 60), now });
  assert.equal(proposed.category, 'payment_pending');

  const sales = sweep.classifyThread({ conversation: aiConv(), lead: { stage: 'NEW' }, last: inbound('course details?', 60), now });
  assert.equal(sales.category, 'sales');
});

test('closed-lost leads are left alone', () => {
  assert.equal(sweep.classifyThread({ conversation: aiConv(), lead: { stage: 'CLOSED_LOST' }, last: inbound('hi', 600), now }).reason, 'closed_lost');
});

test('the enrolled-student backlog reply has no pitch and points at the app', () => {
  assert.match(sweep.ENROLLED_BACKLOG_REPLY, /registration/i);
  assert.match(sweep.ENROLLED_BACKLOG_REPLY, /digitalservicesprogram\.com\/app/);
  assert.doesNotMatch(sweep.ENROLLED_BACKLOG_REPLY, /28,?000|\$100|reserve/i);
});

// ── Stale "Lead confirmed enrollment" holds are released back to the AI ──
const redis = require('../src/config/redis');

test('releaseStaleEnrollmentHandoffs: expired holds with no agent reply → AI on; fresh or agent-touched holds stay', async () => {
  for (const m of ['tenant', 'lead', 'conversation', 'message', 'activity']) db._tables[m].length = 0;
  redis._store.clear();
  const T = 't1';
  const mk = async (id, over = {}, stage = 'PROPOSED') => {
    await db.lead.create({ data: { id: `l-${id}`, tenantId: T, stage, product: 'MASTERY' } });
    return db.conversation.create({ data: { id, tenantId: T, leadId: `l-${id}`, aiEnabled: false, status: 'HUMAN_TAKEOVER',
      handoffReason: 'Lead confirmed enrollment (score=90, intent=high)', handoffAt: ago(180), lastMessageAt: ago(180), ...over } });
  };
  await mk('stale');                                         // → released
  await mk('fresh', { handoffAt: ago(30) });                 // inside grace → kept
  await mk('human', {});                                     // agent replied → kept
  await db.message.create({ data: { id: 'mx', conversationId: 'human', tenantId: T, direction: 'OUTBOUND', sender: 'AGENT', sentAt: ago(100), content: 'hi' } });
  await mk('won', {}, 'CLOSED_WON');                         // paid → not ours
  await mk('other', { handoffReason: 'Payment dispute detected — human required' }); // different rule → kept

  const released = await sweep.releaseStaleEnrollmentHandoffs(T, now);
  assert.equal(released, 1);
  const byId = Object.fromEntries(db._tables.conversation.map((c) => [c.id, c]));
  assert.equal(byId.stale.aiEnabled, true);
  assert.equal(byId.stale.status, 'AI_HANDLING');
  assert.equal(byId.stale.handoffReason, null);
  assert.equal(await redis.get('asos:ai_control:stale'), '1', 'persistent AI control so the Qualifier does not re-confirm');
  for (const id of ['fresh', 'human', 'won', 'other']) assert.equal(byId[id].aiEnabled, false, id);
});
