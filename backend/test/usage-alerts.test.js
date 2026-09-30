// test/usage-alerts.test.js
//
// 80% / 95% AI-usage alerts: once per tenant per period per threshold
// (Redis NX), delivered through the owner systemAlert channel, and surfaced in
// the daily digest.
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

const queuePath = path.resolve(__dirname, '../src/queues/message.queue.js');
require.cache[queuePath] = { id: queuePath, filename: queuePath, loaded: true, exports: { publishInboundMessage: async () => {} } };

const notifications = [];
const notification = require('../src/services/notification.service');
notification.notifyAdmin = async (tenant, eventType, payload) => { notifications.push({ tenantId: tenant.id, eventType, payload }); };

const usage = require('../src/services/usageCycle.service');
const digest = require('../src/services/dailyDigest.service');

const tenant = { id: 't1', name: 'Acme', settings: { adminPhone: '923001234567' } };
const sub = (used, over = {}) => ({ tenantId: 't1', aiTokensUsed: BigInt(used), aiTokensLimit: 1000n, stripeSubId: null,
  usagePeriodStart: new Date('2026-09-15T00:00Z'), usagePeriodEnd: new Date('2026-10-15T00:00Z'), ...over });

beforeEach(() => { for (const t of Object.values(db._tables)) t.length = 0; notifications.length = 0; redis._store.clear(); });

test('crossedThresholds', () => {
  assert.deepEqual(usage.crossedThresholds(790n, 1000n), []);
  assert.deepEqual(usage.crossedThresholds(800n, 1000n), [80]);
  assert.deepEqual(usage.crossedThresholds(949n, 1000n), [80]);
  assert.deepEqual(usage.crossedThresholds(960n, 1000n), [80, 95]);
  assert.deepEqual(usage.crossedThresholds(5000n, 1000n), [80, 95]);
  assert.deepEqual(usage.crossedThresholds(5n, 0n), []);        // no limit → never alert
});

test('crossing 80 and 95 in one reply: both marked, ONE message naming 95%; next reply sends nothing', async () => {
  db._tables.subscription.push(sub(960));
  assert.deepEqual(await usage.maybeAlertUsage(tenant), [80, 95]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].eventType, 'systemAlert');
  assert.match(notifications[0].payload.reason, /95%/);
  assert.deepEqual(await usage.maybeAlertUsage(tenant), []);
  assert.equal(notifications.length, 1);
});

test('80 then later 95 → two separate alerts', async () => {
  db._tables.subscription.push(sub(810));
  assert.deepEqual(await usage.maybeAlertUsage(tenant), [80]);
  db._tables.subscription[0].aiTokensUsed = 955n;
  assert.deepEqual(await usage.maybeAlertUsage(tenant), [95]);
  assert.equal(notifications.length, 2);
  assert.match(notifications[0].payload.reason, /80%/);
});

test('a new usage period re-arms the alerts', async () => {
  db._tables.subscription.push(sub(850));
  await usage.maybeAlertUsage(tenant);
  db._tables.subscription[0].usagePeriodStart = new Date('2026-10-15T00:00Z');
  assert.deepEqual(await usage.maybeAlertUsage(tenant), [80]);
});

test('Stripe tenants key their alerts on the Stripe period', async () => {
  db._tables.subscription.push(sub(850, { stripeSubId: 'sub_1', currentPeriodStart: new Date('2026-09-01T00:00Z') }));
  await usage.maybeAlertUsage(tenant);
  db._tables.subscription[0].currentPeriodStart = new Date('2026-10-01T00:00Z');
  assert.deepEqual(await usage.maybeAlertUsage(tenant), [80]);
});

test('exempt tenant gets no threshold alerts', async () => {
  db._tables.subscription.push(sub(990));
  assert.deepEqual(await usage.maybeAlertUsage({ ...tenant, settings: { billingExempt: true } }), []);
  assert.equal(notifications.length, 0);
});

test('usageSummary: pct, reset date, null without a limit', () => {
  const s = usage.usageSummary(sub(834));
  assert.equal(s.pct, 83);
  assert.equal(s.capped, false);
  assert.deepEqual(s.resetsAt, new Date('2026-10-15T00:00Z'));
  assert.equal(usage.usageSummary(sub(1000)).capped, true);
  assert.equal(usage.usageSummary({ aiTokensUsed: 5n, aiTokensLimit: 0n }), null);
});

const emptySections = () => ({
  now: new Date('2026-09-02T04:00:00Z'), newLeads: [], callList: [],
  followUps: { awaiting: [], awaitingTotal: 0, quiet: [], quietTotal: 0 },
  stalled: { items: [], total: 0 },
  wins: { count: 0, total: 0, currency: 'PKR', leads: [] },
  needsEmail: [],
});

test('digest shows an AI-usage line at ≥80% — even on an otherwise empty day', () => {
  const s = { ...emptySections(), usage: usage.usageSummary(sub(834)) };
  const d = digest.buildDigest(s, { name: 'DSP' });
  assert.match(d.usageLine, /AI usage: 83%/);
  assert.match(digest.renderText(d), /AI usage: 83%/);
  assert.match(digest.renderWhatsAppText(d), /AI usage: 83%/);
});

test('digest at the cap says the AI is paused', () => {
  const d = digest.buildDigest({ ...emptySections(), usage: usage.usageSummary(sub(1000)) }, { name: 'DSP' });
  assert.match(d.usageLine, /100%.*paused/i);
  // An otherwise-empty day must not tell the owner "nothing needs you".
  assert.doesNotMatch(d.subject, /Nothing needs you/);
  assert.match(d.subject, /AI paused/);
});

test('digest omits the usage line below 80% and for exempt tenants', () => {
  assert.equal(digest.buildDigest({ ...emptySections(), usage: usage.usageSummary(sub(500)) }, { name: 'DSP' }).usageLine, null);
  assert.equal(digest.buildDigest({ ...emptySections(), usage: null }, { name: 'DSP' }).usageLine, null);
  assert.doesNotMatch(digest.renderText(digest.buildDigest(emptySections(), { name: 'DSP' })), /AI usage/);
});
