// test/backlog-sweep-token-cap.test.js
//
// The backlog sweep must never spend past the AI-token cap: it leaves the
// cap's own holds to the usage tick, and for a capped tenant it takes no AI
// turns (and releases no human-held thread into a capped AI).
'use strict';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installFakePrisma } = require('./_fakePrisma');
const db = installFakePrisma();

const queuePath = path.resolve(__dirname, '../src/queues/message.queue.js');
require.cache[queuePath] = { id: queuePath, filename: queuePath, loaded: true, exports: { publishInboundMessage: async () => {} } };

const { TOKEN_LIMIT_HANDOFF_REASON } = require('../src/config/constants');
const claude = require('../src/services/claude.service');
const outbound = require('../src/services/outbound.service');
const sweep = require('../src/services/backlogSweep.service');

let aiCalls = 0;
claude.processMessage = async () => { aiCalls += 1; return { reply: 'Sure — here are the details.', action: 'continue', stage: 'QUALIFYING', tokensUsed: 10 }; };
const sent = [];
outbound.sendAndSaveReply = async (p) => { sent.push(p.content); return { sent: true }; };

const now = new Date('2026-09-30T12:00:00Z');
const ago = (min) => new Date(now.getTime() - min * 60_000);

const seed = ({ used, limit = 1000, conv = {}, waitedMin = 60 }) => {
  db._tables.tenant.push({ id: 't1', name: 'Acme', settings: {} });
  db._tables.subscription.push({ tenantId: 't1', aiTokensUsed: BigInt(used), aiTokensLimit: BigInt(limit) });
  db._tables.contact.push({ id: 'k1', tenantId: 't1', phone: '923001111111', name: 'Ayesha' });
  db._tables.lead.push({ id: 'l1', tenantId: 't1', contactId: 'k1', stage: 'QUALIFYING', qualificationData: {} });
  db._tables.conversation.push({ id: 'c1', tenantId: 't1', leadId: 'l1', contactId: 'k1', status: 'AI_HANDLING', aiEnabled: true,
    lastMessageAt: ago(waitedMin), paymentProofDetected: false, ...conv });
  db._tables.message.push({ id: 'm1', tenantId: 't1', conversationId: 'c1', direction: 'INBOUND', sender: 'CONTACT', content: 'fee kya hai?', sentAt: ago(waitedMin) });
};

beforeEach(() => { for (const t of Object.values(db._tables)) t.length = 0; aiCalls = 0; sent.length = 0; });

test('classifyThread leaves token-limit holds to the usage tick — even past the human grace', () => {
  const v = sweep.classifyThread({
    conversation: { id: 'c1', status: 'HUMAN_TAKEOVER', aiEnabled: false, handoffReason: TOKEN_LIMIT_HANDOFF_REASON },
    lead: { stage: 'QUALIFYING' }, last: { id: 'm1', direction: 'INBOUND', content: 'hello?', sentAt: ago(60 * 24) }, now,
  });
  assert.deepEqual(v, { action: 'skip', reason: 'token_limit_hold' });
});

test('…but a refund / legal message on a held thread is still flagged for a human', () => {
  const v = sweep.classifyThread({
    conversation: { id: 'c1', status: 'HUMAN_TAKEOVER', aiEnabled: false, handoffReason: TOKEN_LIMIT_HANDOFF_REASON },
    lead: { stage: 'QUALIFYING' }, last: { id: 'm1', direction: 'INBOUND', content: 'I want a refund', sentAt: ago(60 * 24) }, now,
  });
  assert.equal(v.flagged, 'refund_dispute');
});

test('capped tenant: no AI turn, nothing sent, counted as token_limit', async () => {
  seed({ used: 1000 });
  const s = await sweep.sweepTenant('t1', { now });
  assert.equal(aiCalls, 0);
  assert.equal(sent.length, 0);
  assert.equal(s.skipped.token_limit, 1);
});

test('capped tenant: a human-held thread past its grace is NOT switched back to a capped AI', async () => {
  seed({ used: 1000, waitedMin: 180, conv: { status: 'HUMAN_TAKEOVER', aiEnabled: false, handoffReason: 'Lead asked for a human' } });
  await sweep.sweepTenant('t1', { now });
  const c = db._tables.conversation[0];
  assert.equal(c.aiEnabled, false);
  assert.equal(aiCalls, 0);
});

test('exempt tenant over its limit still gets answered', async () => {
  seed({ used: 5000 });
  db._tables.tenant[0].settings = { billingExempt: true };
  await sweep.sweepTenant('t1', { now });
  assert.equal(aiCalls, 1);
});

test('headroom is re-checked after every AI turn — one run cannot overshoot the cap', async () => {
  seed({ used: 990 });
  db._tables.conversation.push({ id: 'c2', tenantId: 't1', leadId: 'l1', contactId: 'k1', status: 'AI_HANDLING', aiEnabled: true, lastMessageAt: ago(61), paymentProofDetected: false });
  db._tables.message.push({ id: 'm2', tenantId: 't1', conversationId: 'c2', direction: 'INBOUND', sender: 'CONTACT', content: 'kab start hai?', sentAt: ago(61) });
  const orig = claude.processMessage;
  claude.processMessage = async (args) => { db._tables.subscription[0].aiTokensUsed += 50n; return orig(args); };
  try {
    const s = await sweep.sweepTenant('t1', { now });
    assert.equal(aiCalls, 1);
    assert.equal(s.skipped.token_limit, 1);
  } finally { claude.processMessage = orig; }
});

test('control: under the cap the sweep answers as before', async () => {
  seed({ used: 10 });
  await sweep.sweepTenant('t1', { now });
  assert.equal(aiCalls, 1);
  assert.equal(sent.length, 1);
});
