// test/billing-exempt.test.js
//
// tenant.settings.billingExempt: usage is still metered, the AI-token cap is
// never enforced — and only an operator (migration / SQL) can set it.
'use strict';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { installFakePrisma } = require('./_fakePrisma');
const db = installFakePrisma();

const billing = require('../src/modules/billing/billing.service');
const settings = require('../src/modules/settings/settings.service');
const { isBillingExempt } = require('../src/services/usageCycle.service');

beforeEach(() => { for (const t of Object.values(db._tables)) t.length = 0; });

test('exempt tenant over its limit is not blocked', async () => {
  db._tables.tenant.push({ id: 'dsp', settings: { billingExempt: true } });
  db._tables.subscription.push({ tenantId: 'dsp', aiTokensUsed: 1500n, aiTokensLimit: 1000n });
  await assert.doesNotReject(billing.checkPlanLimits('dsp', 'ai_tokens'));
});

test('exempt flag on a passed-in tenant object skips the tenant lookup', async () => {
  db._tables.subscription.push({ tenantId: 'dsp', aiTokensUsed: 1500n, aiTokensLimit: 1000n });
  await assert.doesNotReject(billing.checkPlanLimits('dsp', 'ai_tokens', { tenant: { id: 'dsp', settings: { billingExempt: true } } }));
});

test('non-exempt tenant at its limit → 402', async () => {
  db._tables.tenant.push({ id: 't1', settings: {} });
  db._tables.subscription.push({ tenantId: 't1', aiTokensUsed: 1000n, aiTokensLimit: 1000n });
  await assert.rejects(billing.checkPlanLimits('t1', 'ai_tokens'), { statusCode: 402 });
});

test('exemption covers AI tokens only — contact limits still apply', async () => {
  db._tables.tenant.push({ id: 'dsp', settings: { billingExempt: true } });
  db._tables.subscription.push({ tenantId: 'dsp', contactsLimit: 1, aiTokensUsed: 0n, aiTokensLimit: 1000n });
  db._tables.contact.push({ id: 'c1', tenantId: 'dsp' });
  await assert.rejects(billing.checkPlanLimits('dsp', 'contacts'), { statusCode: 402 });
});

test('isBillingExempt is strict boolean true', () => {
  assert.equal(isBillingExempt({ settings: { billingExempt: true } }), true);
  assert.equal(isBillingExempt({ settings: { billingExempt: 'true' } }), false);
  assert.equal(isBillingExempt({ settings: {} }), false);
  assert.equal(isBillingExempt(null), false);
});

test('a tenant admin cannot grant themselves billingExempt through settings', async () => {
  db._tables.tenant.push({ id: 't1', name: 'T', settings: { adminPhone: '923001234567' } });
  await settings.updateSettings('t1', { settings: { billingExempt: true, adminPhone: '923009999999' } });
  const row = db._tables.tenant.find((t) => t.id === 't1');
  assert.equal(row.settings.billingExempt, undefined);
  assert.equal(row.settings.adminPhone, '923009999999');
});

test('…nor clear an exemption an operator set', async () => {
  db._tables.tenant.push({ id: 'dsp', name: 'DSP', settings: { billingExempt: true } });
  await settings.updateSettings('dsp', { settings: { billingExempt: false } });
  assert.equal(db._tables.tenant.find((t) => t.id === 'dsp').settings.billingExempt, true);
});
