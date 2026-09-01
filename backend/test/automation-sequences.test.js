// test/automation-sequences.test.js
//
// Multi-touch sequences (services/automation.steps.js): a rule can carry
// ordered follow-up touches — touch 1, wait 3 days, touch 2, wait 4 days,
// touch 3, stop — and the whole thing must cancel the moment the lead
// replies. These tests pin the pure step/cancel rules; no DB, no network.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSteps, validateSteps, planAfterTouch, cancelReasonFor, isChaseTrigger, CANCEL_REASONS, MAX_STEPS,
} = require('../src/services/automation.steps');

const DAY = 86_400_000;
const tpl = (name) => ({ name, language: 'en', bodyParams: ['{name}'] });
const threeTouch = {
  type: 'send_whatsapp', template: 'legacy text',
  steps: [
    { delay: 0, unit: 'hours', template: 'Salam {name}, did you see our message?', waTemplate: tpl('dsp_no_reply_followup') },
    { delay: 3, unit: 'days', template: 'New angle {name}: a student result.', waTemplate: tpl('dsp_cold_reengage') },
    { delay: 4, unit: 'days', template: 'Last call {name} — seats close Friday.', waTemplate: tpl('dsp_cold_reengage') },
  ],
};

test('a legacy single-template rule is exactly a one-step sequence', () => {
  const steps = normalizeSteps({ type: 'send_whatsapp', template: 'Hi {name}', waTemplate: tpl('dsp_no_reply_followup') });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].template, 'Hi {name}');
  assert.equal(steps[0].waTemplate.name, 'dsp_no_reply_followup');
  assert.equal(steps[0].delay, 0);
  // Nothing to validate on a single step — existing rules keep saving.
  assert.deepEqual(validateSteps({ type: 'send_whatsapp', template: 'Hi {name}' }), []);
});

test('multi-step rules keep their order and step 1 ignores its delay', () => {
  const steps = normalizeSteps({ ...threeTouch, steps: [{ ...threeTouch.steps[0], delay: 99 }, ...threeTouch.steps.slice(1)] });
  assert.equal(steps.length, 3);
  assert.equal(steps[0].delay, 0);
  assert.deepEqual(steps.map((s) => s.delay), [0, 3, 4]);
  assert.deepEqual(steps.map((s) => s.unit), ['hours', 'days', 'days']);
});

test('after each touch the enrolment row schedules the next one, then finishes', () => {
  const steps = normalizeSteps(threeTouch);
  const t0 = new Date('2026-09-02T04:00:00Z');

  const after1 = planAfterTouch(steps, 0, t0);
  assert.equal(after1.status, 'ACTIVE');
  assert.equal(after1.step, 1);
  assert.equal(after1.nextDueAt.getTime(), t0.getTime() + 3 * DAY);

  const t1 = after1.nextDueAt;
  const after2 = planAfterTouch(steps, 1, t1);
  assert.equal(after2.status, 'ACTIVE');
  assert.equal(after2.step, 2);
  assert.equal(after2.nextDueAt.getTime(), t1.getTime() + 4 * DAY);

  const after3 = planAfterTouch(steps, 2, after2.nextDueAt);
  assert.equal(after3.status, 'SENT');
  assert.equal(after3.step, 3);
  assert.equal(after3.nextDueAt, null);
});

test('a follow-up touch without an approved template is rejected — it can never deliver outside 24h', () => {
  const problems = validateSteps({ ...threeTouch, steps: [threeTouch.steps[0], { delay: 3, unit: 'days', template: 'plain text only' }] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /step 2: an approved WhatsApp template is required/);
});

test('a follow-up touch needs a positive delay and real text', () => {
  const problems = validateSteps({ ...threeTouch, steps: [threeTouch.steps[0], { delay: 0, unit: 'days', template: 'x', waTemplate: tpl('dsp_cold_reengage') }] });
  assert.ok(problems.some((p) => /step 2: delay must be greater than 0/.test(p)));
  assert.ok(problems.some((p) => /step 2: message text is required/.test(p)));
  assert.deepEqual(validateSteps(threeTouch), []);
});

test('sequences are capped', () => {
  const steps = Array.from({ length: MAX_STEPS + 1 }, (_, i) => ({ delay: i ? 1 : 0, unit: 'days', template: 'Touch text here', waTemplate: tpl('t') }));
  assert.ok(validateSteps({ steps }).some((p) => /at most/.test(p)));
});

// ── Cancel rules ────────────────────────────────────────────────────
const lead = (over = {}) => ({ id: 'l1', stage: 'QUALIFYING', ...over });
const conv = (over = {}) => ({ id: 'c1', status: 'AI_HANDLING', aiEnabled: true, ...over });
const since = new Date('2026-09-02T04:00:00Z');
const before = new Date(since.getTime() - DAY);
const after = new Date(since.getTime() + 3600_000);

test('the sequence proceeds when nothing happened since the last touch', () => {
  assert.equal(cancelReasonFor({ lead: lead(), conv: conv(), facts: { lastInboundAt: before, lastAgentAt: null }, since }), null);
});

test('any reply from the lead after the last touch cancels the sequence', () => {
  const reason = cancelReasonFor({ lead: lead(), conv: conv(), facts: { lastInboundAt: after, lastAgentAt: null }, since });
  assert.equal(reason, CANCEL_REASONS.replied);
});

test('a human agent messaging the lead cancels it — no bot nudge mid-conversation', () => {
  const reason = cancelReasonFor({ lead: lead(), conv: conv(), facts: { lastInboundAt: before, lastAgentAt: after }, since });
  assert.equal(reason, CANCEL_REASONS.agent);
});

test('a lead that paid (chase rule), was lost, or was handed to a human is no longer eligible', () => {
  const facts = { lastInboundAt: before, lastAgentAt: null };
  assert.equal(cancelReasonFor({ lead: lead({ stage: 'CLOSED_WON' }), conv: conv(), facts, since, excludeWon: true }), CANCEL_REASONS.ineligible);
  assert.equal(cancelReasonFor({ lead: lead({ stage: 'CLOSED_LOST' }), conv: conv(), facts, since }), CANCEL_REASONS.ineligible);
  assert.equal(cancelReasonFor({ lead: lead(), conv: conv({ status: 'HUMAN_TAKEOVER' }), facts, since }), CANCEL_REASONS.ineligible);
  assert.equal(cancelReasonFor({ lead: lead(), conv: conv({ status: 'PENDING_VERIFICATION' }), facts, since }), CANCEL_REASONS.ineligible);
  assert.equal(cancelReasonFor({ lead: lead(), conv: conv({ aiEnabled: false }), facts, since }), CANCEL_REASONS.ineligible);
  assert.equal(cancelReasonFor({ lead: null, conv: null, facts, since }), CANCEL_REASONS.ineligible);
});

test('lifecycle rules still finish their sequence for an enrolled (CLOSED_WON) student', () => {
  // Same split as test/automation-never-chases-won.test.js: only chase
  // triggers stop at CLOSED_WON.
  const facts = { lastInboundAt: before, lastAgentAt: null };
  assert.equal(cancelReasonFor({ lead: lead({ stage: 'CLOSED_WON' }), conv: conv(), facts, since, excludeWon: false }), null);
  assert.equal(isChaseTrigger({ trigger: { type: 'no_reply' } }), true);
  assert.equal(isChaseTrigger({ trigger: { type: 'no_activity' } }), true);
  assert.equal(isChaseTrigger({ trigger: { type: 'stage_entered' } }), false);
  assert.equal(isChaseTrigger({ trigger: { type: 'mastery_event' } }), false);
});
