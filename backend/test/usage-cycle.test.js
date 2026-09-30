// test/usage-cycle.test.js
//
// Monthly AI-usage reset: the period arithmetic (pure) and the tick that
// resets counters exactly once per period, never for Stripe-managed tenants.
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

// message.queue builds real BullMQ queues on require — stub it.
const published = [];
const queuePath = path.resolve(__dirname, '../src/queues/message.queue.js');
require.cache[queuePath] = { id: queuePath, filename: queuePath, loaded: true, exports: { publishInboundMessage: async (p) => { published.push(p); } } };

const usage = require('../src/services/usageCycle.service');
const { rollPeriod } = usage;
const d = (s) => new Date(s);

beforeEach(() => { for (const t of Object.values(db._tables)) t.length = 0; published.length = 0; });

test('period not yet over → unchanged', () => {
  const r = rollPeriod({ start: d('2026-09-15T00:00Z'), end: d('2026-10-15T00:00Z'), now: d('2026-09-30T00:00Z') });
  assert.equal(r.rolled, false);
});

test('period ending exactly now rolls', () => {
  const r = rollPeriod({ start: d('2026-08-15T00:00Z'), end: d('2026-09-15T00:00Z'), now: d('2026-09-15T00:00Z') });
  assert.deepEqual([r.start, r.end, r.rolled], [d('2026-09-15T00:00Z'), d('2026-10-15T00:00Z'), true]);
});

test('several missed months jump straight to the period containing now', () => {
  const r = rollPeriod({ start: d('2026-03-15T00:00Z'), end: d('2026-04-15T00:00Z'), now: d('2026-09-30T00:00Z') });
  assert.deepEqual([r.start, r.end, r.rolled], [d('2026-09-15T00:00Z'), d('2026-10-15T00:00Z'), true]);
});

test('month-end anchor clamps without drifting', () => {
  const a = rollPeriod({ start: d('2026-01-31T00:00Z'), end: d('2026-02-28T00:00Z'), now: d('2026-03-01T00:00Z') });
  assert.deepEqual([a.start, a.end], [d('2026-02-28T00:00Z'), d('2026-03-31T00:00Z')]);
  const b = rollPeriod({ start: a.start, end: a.end, now: d('2026-04-01T00:00Z') });
  assert.deepEqual([b.start, b.end], [d('2026-03-31T00:00Z'), d('2026-04-30T00:00Z')]);
});

test('runUsageTick resets expired, non-Stripe subscriptions exactly once — even when two ticks race', async () => {
  db._tables.subscription.push(
    { id: 's1', tenantId: 't1', stripeSubId: null, aiTokensUsed: 900n, aiTokensLimit: 1000n, messagesUsed: 50,
      usagePeriodStart: d('2026-08-15T00:00Z'), usagePeriodEnd: d('2026-09-15T00:00Z') },
    { id: 's2', tenantId: 't2', stripeSubId: 'sub_x', aiTokensUsed: 900n, aiTokensLimit: 1000n, messagesUsed: 5,
      usagePeriodStart: d('2026-08-01T00:00Z'), usagePeriodEnd: d('2026-09-01T00:00Z') },
    { id: 's3', tenantId: 't3', stripeSubId: null, aiTokensUsed: 10n, aiTokensLimit: 1000n, messagesUsed: 1,
      usagePeriodStart: d('2026-09-20T00:00Z'), usagePeriodEnd: d('2026-10-20T00:00Z') },
  );
  const now = d('2026-09-30T00:00Z');
  const [a, b] = await Promise.all([usage.runUsageTick({ now }), usage.runUsageTick({ now })]);
  assert.deepEqual([...a.reset, ...b.reset], ['t1']);
  const s1 = db._tables.subscription.find((s) => s.id === 's1');
  assert.equal(Number(s1.aiTokensUsed), 0);
  assert.equal(s1.messagesUsed, 0);
  assert.deepEqual([s1.usagePeriodStart, s1.usagePeriodEnd], [d('2026-09-15T00:00Z'), d('2026-10-15T00:00Z')]);
  assert.equal(Number(db._tables.subscription.find((s) => s.id === 's2').aiTokensUsed), 900); // Stripe owns its cycle
  assert.equal(Number(db._tables.subscription.find((s) => s.id === 's3').aiTokensUsed), 10);  // mid-period
});

test('subscription with no usage period yet is initialised, not reset', async () => {
  db._tables.subscription.push({ id: 's4', tenantId: 't4', stripeSubId: null, aiTokensUsed: 70n, aiTokensLimit: 1000n, messagesUsed: 3,
    createdAt: d('2026-07-10T08:00Z'), usagePeriodStart: null, usagePeriodEnd: null });
  const r = await usage.runUsageTick({ now: d('2026-09-30T00:00Z') });
  const s4 = db._tables.subscription.find((s) => s.id === 's4');
  assert.deepEqual([s4.usagePeriodStart, s4.usagePeriodEnd], [d('2026-09-10T08:00Z'), d('2026-10-10T08:00Z')]);
  assert.equal(Number(s4.aiTokensUsed), 70);
  assert.deepEqual(r.reset, []);
});
