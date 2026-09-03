// test/elevenlabs-webhook-stage.test.js
//
// Pins the guardrails on the WhatsApp voice agent's /webhooks/elevenlabs/lead
// endpoint. The agent runs the conversation on Meta's side and reports back
// where it thinks the lead is; these rules are the reason a chatty caller
// cannot rewrite the pipeline.
//
// Two failure modes are being prevented:
//
//  1. Inventing revenue. "Won means paid" is the rule the whole reporting
//     stack rests on (see the 1 Sep 2026 reconciliation, where 131 zero-value
//     claimed wins had to be demoted by hand). A caller saying "I've paid"
//     is a PROPOSED lead plus a human-verification flag — never a CLOSED_WON.
//
//  2. Dragging people backwards. An enrolled student who messages the number
//     with a question must not be pulled out of CLOSED_WON, and a lead that
//     already reached link_sent must not fall back to QUALIFYING because the
//     next call only reported 'qualified'.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveStage, STAGE_MAP } = require('../src/webhooks/elevenlabs.stages');

test('the agent can never write a won stage, whatever it reports', () => {
  for (const reported of Object.keys(STAGE_MAP)) {
    assert.notEqual(STAGE_MAP[reported], 'CLOSED_WON', `${reported} must not map to CLOSED_WON`);
    assert.notEqual(STAGE_MAP[reported], 'CLOSED_LOST', `${reported} must not map to CLOSED_LOST`);
  }
});

test('a caller claiming payment lands at PROPOSED, not a win', () => {
  // The proof still has to be matched on the enrol page. This is the single
  // most expensive thing to get wrong — it is what makes revenue reporting lie.
  assert.equal(STAGE_MAP.paid, 'PROPOSED');
  assert.deepEqual(resolveStage('QUALIFYING', 'paid'), { target: 'PROPOSED', advance: true });
});

test('an enrolled student is never pulled back out of CLOSED_WON', () => {
  for (const reported of Object.keys(STAGE_MAP)) {
    assert.equal(resolveStage('CLOSED_WON', reported).advance, false,
      `reported '${reported}' must not move a won lead`);
  }
});

test('a lost lead is reopened by a human, not by the agent', () => {
  for (const reported of Object.keys(STAGE_MAP)) {
    assert.equal(resolveStage('CLOSED_LOST', reported).advance, false);
  }
});

test('the pipeline only ever moves forward', () => {
  assert.equal(resolveStage('PROPOSED', 'qualified').advance, false);
  assert.equal(resolveStage('DIAGNOSED', 'new').advance, false);
  assert.equal(resolveStage('QUALIFYING', 'qualified').advance, false); // same stage is not a move
  assert.equal(resolveStage('NEW', 'link_sent').advance, true);
  assert.equal(resolveStage('QUALIFYING', 'email_captured').advance, true);
});

test('a brand-new lead always lands on its reported stage', () => {
  for (const reported of Object.keys(STAGE_MAP)) {
    assert.deepEqual(resolveStage(null, reported), { target: STAGE_MAP[reported], advance: true });
  }
});

test('an objection keeps the lead in the pipeline rather than losing it', () => {
  // Someone pushing back on price is still a live lead — CLOSED_LOST is a
  // human's call, and marking it here would hide them from re-engagement.
  assert.equal(STAGE_MAP.objection, 'QUALIFYING');
});
