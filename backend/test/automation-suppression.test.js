// test/automation-suppression.test.js
//
// Item 5 — "No-Reply Follow-up", "Cold Lead Re-engage (7d)" and "Unpaid
// Enrollment Reminder" skip: CLOSED_WON, CLOSED_LOST (refund / duplicate),
// formSubmittedAt set, "already enrolled", and opt-outs. Sequences are
// capped at 3 touches and cancel on any inbound reply.
'use strict';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const steps = require('../src/services/automation.steps');
const { baseLeadWhere } = require('../src/services/automation.service');

const noReply   = { id: 'r-noreply', tenantId: 't1', name: 'No-Reply Follow-up',        trigger: { type: 'no_reply', delay: 12, unit: 'hours' }, condition: { stage: 'any' } };
const coldRe    = { id: 'r-cold',    tenantId: 't1', name: 'Cold Lead Re-engage (7d)',  trigger: { type: 'no_activity', delay: 7, unit: 'days' }, condition: {} };
const unpaid    = { id: 'r-unpaid',  tenantId: 't1', name: 'Unpaid Enrollment Reminder', trigger: { type: 'stage_entered', stage: 'PROPOSED', delay: 2, unit: 'days' }, condition: {} };
const welcome   = { id: 'r-welcome', tenantId: 't1', name: 'Mastery: Welcome to the dashboard', trigger: { type: 'mastery_event', event: 'enrolled', delay: 0 }, condition: {} };
const wonStage  = { id: 'r-won',     tenantId: 't1', name: 'Enrollment Welcome Sequence', trigger: { type: 'stage_entered', stage: 'CLOSED_WON', delay: 0 }, condition: {} };

test('the three sales rules are sales rules; welcome / lifecycle rules are not', () => {
  assert.ok(steps.isSalesRule(noReply));
  assert.ok(steps.isSalesRule(coldRe));
  assert.ok(steps.isSalesRule(unpaid));
  assert.equal(steps.isSalesRule(welcome), false);
  assert.equal(steps.isSalesRule(wonStage), false);
});

test('findMatches filter: sales rules skip formSubmittedAt / already-enrolled / opt-outs', () => {
  for (const rule of [noReply, coldRe, unpaid]) {
    const where = baseLeadWhere(rule, { excludeWon: steps.isChaseTrigger(rule) });
    assert.equal(where.formSubmittedAt, null, `${rule.name} skips formSubmittedAt`);
    assert.equal(where.alreadyEnrolledAt, null, `${rule.name} skips already-enrolled`);
    assert.deepEqual(where.contact, { optedOutAt: null }, `${rule.name} skips opt-outs`);
    // CLOSED_LOST — refund / duplicate / any reason — is never touched.
    assert.ok(where.stage.notIn.includes('CLOSED_LOST'));
  }
  // Chase rules also skip CLOSED_WON; the PROPOSED reminder's findMatches
  // query additionally pins stage to the trigger stage (stage: t.stage).
  assert.deepEqual(baseLeadWhere(noReply, { excludeWon: true }).stage, { notIn: ['CLOSED_LOST', 'CLOSED_WON'] });
  assert.deepEqual(baseLeadWhere(unpaid).stage, { notIn: ['CLOSED_LOST'] });
});

test('lifecycle rules still reach enrolled students (only opt-outs are skipped)', () => {
  for (const rule of [welcome, wonStage]) {
    const where = baseLeadWhere(rule);
    assert.equal('formSubmittedAt' in where, false, `${rule.name} must reach a student who filled the form`);
    assert.equal('alreadyEnrolledAt' in where, false);
    assert.deepEqual(where.contact, { optedOutAt: null });
    assert.deepEqual(where.stage, { notIn: ['CLOSED_LOST'] });
  }
});

test('advanceDue re-check: a pending touch is cancelled for every suppressed case', () => {
  const conv = { aiEnabled: true, status: 'AI_HANDLING' };
  const since = new Date('2026-09-10T00:00:00Z');
  const facts = { lastInboundAt: null, lastAgentAt: null };
  const base = { id: 'l1', stage: 'PROPOSED', contact: { optedOutAt: null } };
  const cases = [
    ['CLOSED_WON', { ...base, stage: 'CLOSED_WON' }],
    ['CLOSED_LOST (refund)', { ...base, stage: 'CLOSED_LOST', lostReason: 'refund' }],
    ['CLOSED_LOST (duplicate)', { ...base, stage: 'CLOSED_LOST', lostReason: 'duplicate' }],
    ['formSubmittedAt', { ...base, formSubmittedAt: new Date() }],
    ['already enrolled', { ...base, alreadyEnrolledAt: new Date() }],
    ['opt-out', { ...base, contact: { optedOutAt: new Date() } }],
  ];
  for (const [label, lead] of cases) {
    const reason = steps.cancelReasonFor({ lead, conv, facts, since, excludeWon: false, sales: true });
    assert.ok(reason === steps.CANCEL_REASONS.suppressed || reason === steps.CANCEL_REASONS.ineligible, `${label} → cancelled (got ${reason})`);
  }
  // …and an ordinary PROPOSED lead still gets the touch.
  assert.equal(steps.cancelReasonFor({ lead: base, conv, facts, since, excludeWon: false, sales: true }), null);
});

test('any inbound reply cancels the rest of the sequence', () => {
  const lead = { id: 'l1', stage: 'QUALIFYING', contact: {} };
  const conv = { aiEnabled: true, status: 'AI_HANDLING' };
  const since = new Date('2026-09-10T00:00:00Z');
  const replied = steps.cancelReasonFor({ lead, conv, facts: { lastInboundAt: new Date('2026-09-11T00:00:00Z') }, since, excludeWon: true });
  assert.equal(replied, steps.CANCEL_REASONS.replied);
  // The worker also cancels eagerly the moment a message arrives.
  const src = require('fs').readFileSync(require.resolve('../src/workers/conversation.worker'), 'utf8');
  assert.match(src, /cancelSequencesForLead\(lead\.id, 'lead_replied'\)/);
});

test('sequences are capped at 3 touches — on save and at runtime', () => {
  assert.equal(steps.MAX_STEPS, 3);
  const five = Array.from({ length: 5 }, (_, i) => ({ delay: i ? 1 : 0, unit: 'days', template: 'Touch text here', waTemplate: { name: 't', language: 'en' } }));
  assert.ok(steps.validateSteps({ steps: five }).some((p) => /at most 3/.test(p)));
  assert.equal(steps.normalizeSteps({ steps: five }).length, 3, 'a saved 5-step rule only ever sends 3');
});

test('the lifecycle welcome still reaches a student who filled the form and is CLOSED_WON', () => {
  const lead = { id: 'l1', stage: 'CLOSED_WON', formSubmittedAt: new Date(), contact: { optedOutAt: null } };
  assert.equal(steps.isSuppressed(lead, { sales: false }), false);
  assert.equal(steps.isSuppressed(lead, { sales: true }), true);
});
