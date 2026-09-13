// test/won-guard.test.js
//
// Item 1 — the AI may never set CLOSED_WON for the Mastery tenant. Only the
// Mastery webhook (enrolment approved) or a human in the dashboard can. The
// guard holds the lead at PROPOSED and logs ev "won-guard".
'use strict';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';
process.env.MASTERY_TENANT_ID ||= '87bfa1b0-1774-4278-b630-d30836cf4183';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guardAiStageTransition, isMasteryGuardedTenant, EV } = require('../src/services/agent-guards/won-guard');

const DSP = '87bfa1b0-1774-4278-b630-d30836cf4183';

test('AI-initiated CLOSED_WON on the Mastery tenant is blocked and held at PROPOSED', () => {
  const r = guardAiStageTransition({ tenantId: DSP, leadId: 'l1', fromStage: 'DIAGNOSED', toStage: 'CLOSED_WON', guardedTenantId: DSP });
  assert.equal(r.stage, 'PROPOSED');
  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'ai_cannot_set_won');
  assert.equal(EV, 'won-guard');
});

test('every other AI transition passes through untouched', () => {
  for (const to of ['NEW', 'QUALIFYING', 'DIAGNOSED', 'PROPOSED', 'CLOSED_LOST']) {
    const r = guardAiStageTransition({ tenantId: DSP, fromStage: 'NEW', toStage: to, guardedTenantId: DSP });
    assert.equal(r.stage, to);
    assert.equal(r.blocked, false);
  }
});

test('a lead that is ALREADY won (by the webhook or a human) is not touched', () => {
  const r = guardAiStageTransition({ tenantId: DSP, fromStage: 'CLOSED_WON', toStage: 'CLOSED_WON', guardedTenantId: DSP });
  assert.equal(r.stage, 'CLOSED_WON');
  assert.equal(r.blocked, false);
});

test('tenants without a Mastery integration are not affected', () => {
  const r = guardAiStageTransition({ tenantId: 'other-tenant', fromStage: 'PROPOSED', toStage: 'CLOSED_WON', guardedTenantId: DSP });
  assert.equal(r.stage, 'CLOSED_WON');
  assert.equal(r.blocked, false);
  assert.equal(isMasteryGuardedTenant('other-tenant', DSP), false);
  assert.equal(isMasteryGuardedTenant(DSP, DSP), true);
  // No MASTERY_TENANT_ID configured at all → nothing is guarded.
  assert.equal(isMasteryGuardedTenant(DSP, null), false);
});

test('the guard is wired into the closer stage path (claude.service exports deriveStage; the worker applies the guard again)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/services/claude.service'), 'utf8');
  assert.match(src, /guardAiStageTransition\(\{\s*tenantId, leadId: lead\.id, fromStage: lead\.stage, toStage: deriveStage\(/);
  const worker = require('fs').readFileSync(require.resolve('../src/workers/conversation.worker'), 'utf8');
  assert.match(worker, /aiResult\.stage = guardAiStageTransition\(/);
});
