// test/token-limit-release.test.js
//
// Conversations the AI-token cap handed to a human go back to the AI as soon
// as the tenant has headroom (limit raised, period reset, or exempt) — and
// the lead's unanswered question actually gets answered, exactly once.
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
const redis = require('../src/config/redis');

const published = [];
const queuePath = path.resolve(__dirname, '../src/queues/message.queue.js');
require.cache[queuePath] = { id: queuePath, filename: queuePath, loaded: true, exports: { publishInboundMessage: async (p) => { published.push(p); } } };

const { TOKEN_LIMIT_HANDOFF_REASON } = require('../src/config/constants');
const usage = require('../src/services/usageCycle.service');
const outbound = require('../src/services/outbound.service');

const T = (min) => new Date(Date.UTC(2026, 8, 30, 10, min));
const tenant = { id: 't1', name: 'Acme', settings: {} };
const conv = (id) => db._tables.conversation.find((c) => c.id === id);

const seed = ({ used = 0, limit = 1000, exempt = false } = {}) => {
  db._tables.tenant.push({ ...tenant, settings: exempt ? { billingExempt: true } : {} });
  db._tables.subscription.push({ tenantId: 't1', aiTokensUsed: BigInt(used), aiTokensLimit: BigInt(limit), stripeSubId: null,
    usagePeriodStart: T(0), usagePeriodEnd: new Date('2026-10-30T10:00Z') });
  db._tables.contact.push({ id: 'k1', tenantId: 't1', phone: '923001111111', name: 'Ayesha' });
  db._tables.lead.push({ id: 'l1', tenantId: 't1', contactId: 'k1', stage: 'QUALIFYING' });
  // c1: capped — lead asked, got the farewell, then the handoff.
  db._tables.conversation.push({ id: 'c1', tenantId: 't1', leadId: 'l1', contactId: 'k1', aiEnabled: false, status: 'HUMAN_TAKEOVER',
    handoffReason: TOKEN_LIMIT_HANDOFF_REASON, handoffAt: T(2) });
  db._tables.message.push(
    { id: 'm1', tenantId: 't1', conversationId: 'c1', direction: 'INBOUND', sender: 'CONTACT', content: 'fee kitni hai?', waMessageId: 'wamid.1', sentAt: T(1) },
    { id: 'm2', tenantId: 't1', conversationId: 'c1', direction: 'OUTBOUND', sender: 'AI', content: 'Our team will get back to you shortly.', sentAt: T(1.5) },
  );
  // c2: a human handoff for another reason — never touched.
  db._tables.conversation.push({ id: 'c2', tenantId: 't1', leadId: 'l1', contactId: 'k1', aiEnabled: false, status: 'HUMAN_TAKEOVER',
    handoffReason: 'Lead asked for a human', handoffAt: T(2) });
};

beforeEach(() => { for (const t of Object.values(db._tables)) t.length = 0; published.length = 0; redis._store.clear(); });

test('headroom again → cap-held thread released and the unanswered question re-queued past the farewell', async () => {
  seed({ used: 0 });
  const r = await usage.releaseAllEligibleHolds();
  assert.deepEqual(r, { t1: 1 });
  assert.equal(conv('c1').aiEnabled, true);
  assert.equal(conv('c1').status, 'AI_HANDLING');
  assert.equal(conv('c1').handoffReason, null);
  assert.equal(conv('c2').aiEnabled, false);                          // human handoff untouched
  assert.equal(published.length, 1);
  assert.equal(published[0].waMessageId, 'wamid.1');
  assert.equal(published[0].replay, true);
  assert.equal(published[0].phone, '923001111111');
  assert.equal(new Date(published[0].answeredAfter).getTime(), T(2).getTime()); // farewell doesn't count as an answer
  // Not a human handback: no persistent AI-control flag.
  assert.equal([...redis._store.keys()].filter((k) => k.startsWith('asos:ai_control:')).length, 0);
  assert.ok(db._tables.activity.some((a) => a.leadId === 'l1' && /token limit/i.test(a.content)));
});

test('still at the cap → nothing released', async () => {
  seed({ used: 1000 });
  assert.deepEqual(await usage.releaseAllEligibleHolds(), {});
  assert.equal(conv('c1').aiEnabled, false);
  assert.equal(published.length, 0);
});

test('exempt tenant at the cap → released', async () => {
  seed({ used: 5000, exempt: true });
  assert.deepEqual(await usage.releaseAllEligibleHolds(), { t1: 1 });
});

test('a human answered during the hold → released, but nothing re-queued', async () => {
  seed({ used: 0 });
  db._tables.message.push({ id: 'm3', tenantId: 't1', conversationId: 'c1', direction: 'OUTBOUND', sender: 'AGENT', content: 'Fee is 28k', sentAt: T(5) });
  await usage.releaseAllEligibleHolds();
  assert.equal(conv('c1').aiEnabled, true);
  assert.equal(published.length, 0);
});

test('lead wrote again during the hold → the NEWEST inbound is re-queued', async () => {
  seed({ used: 0 });
  db._tables.message.push({ id: 'm4', tenantId: 't1', conversationId: 'c1', direction: 'INBOUND', sender: 'CONTACT', content: 'hello??', waMessageId: 'wamid.4', sentAt: T(30) });
  await usage.releaseAllEligibleHolds();
  assert.deepEqual(published.map((p) => p.waMessageId), ['wamid.4']);
});

test('a human took the thread over between scan and release → not overridden', async () => {
  seed({ used: 0 });
  // Simulate the race: the guard in the update must re-check the reason.
  const orig = db.conversation.findMany;
  db.conversation.findMany = async (args) => {
    const rows = await orig(args);
    if (args?.where?.tenantId) conv('c1').handoffReason = 'Manual takeover'; // after the per-tenant read
    return rows;
  };
  try { await usage.releaseAllEligibleHolds(); } finally { db.conversation.findMany = orig; }
  assert.equal(conv('c1').aiEnabled, false);
  assert.equal(published.length, 0);
});

test('limit raised → the next usage tick releases', async () => {
  seed({ used: 1000 });
  assert.deepEqual((await usage.runUsageTick({ now: T(10) })).released, {});
  db._tables.subscription[0].aiTokensLimit = 5000n;
  assert.deepEqual((await usage.runUsageTick({ now: T(15) })).released, { t1: 1 });
});

test('period reset → the same tick resets and releases', async () => {
  seed({ used: 1000 });
  db._tables.subscription[0].usagePeriodEnd = T(5);
  const r = await usage.runUsageTick({ now: T(10) });
  assert.deepEqual(r.reset, ['t1']);
  assert.deepEqual(r.released, { t1: 1 });
});

test('repliesSince ignores outbound at or before answeredAfter', async () => {
  seed();
  const inbound = db._tables.message.find((m) => m.id === 'm1');
  assert.equal(await outbound.repliesSince({ tenantId: 't1', inbound }), 1);
  assert.equal(await outbound.repliesSince({ tenantId: 't1', inbound, answeredAfter: T(2).toISOString() }), 0);
});
