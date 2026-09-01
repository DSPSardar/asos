// test/automation-never-chases-won.test.js
//
// Regression guard for a live incident found on 2026-09-01: the "No-Reply
// Follow-up" rule (trigger no_reply, condition stage 'any') had been enabled
// since 2026-08-26 and sent 169 WhatsApp templates. Six of those went to leads
// that were ALREADY CLOSED_WON at send time — paying students asked
// "aap ne humare AI Agents course ke baare mein pucha tha... koi sawaal hai?"
// baseLeadWhere() only ever excluded CLOSED_LOST, so a chase rule with
// condition.stage 'any' happily reached customers who had already bought.
// At the time of the fix a further 40 paid students were still exposed.
//
// The fix is deliberately narrow: only the CHASE triggers (no_reply /
// no_activity) exclude CLOSED_WON. The LIFECYCLE triggers (stage_entered,
// dsp_phase_changed, mastery_event) are *supposed* to reach enrolled students
// — that is how Enrollment Welcome, Certificate Issued and the Mastery nudges
// work — so widening the exclusion globally would silently break all of them.
// This test pins both halves of that distinction.
'use strict';

// automation.service pulls in the env-validating config at require time; these
// placeholders are never used because baseLeadWhere is pure and never queries.
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { baseLeadWhere } = require('../src/services/automation.service');

const rule = (condition) => ({ id: 'rule-1', tenantId: 'tenant-1', condition });

test('chase triggers never reach a lead who already bought', () => {
  const where = baseLeadWhere(rule({ stage: 'any' }), { excludeWon: true });
  assert.deepEqual(where.stage, { notIn: ['CLOSED_LOST', 'CLOSED_WON'] });
});

test('lifecycle triggers still reach CLOSED_WON leads', () => {
  // Enrollment Welcome / Certificate Issued / Mastery nudges depend on this.
  assert.deepEqual(baseLeadWhere(rule({ stage: 'any' })).stage, { notIn: ['CLOSED_LOST'] });
  assert.deepEqual(baseLeadWhere(rule({})).stage, { notIn: ['CLOSED_LOST'] });
  assert.deepEqual(baseLeadWhere(rule(undefined)).stage, { notIn: ['CLOSED_LOST'] });
});

test('an explicit condition.stage still wins, even on a chase trigger', () => {
  // A rule that deliberately targets won leads must stay able to.
  const where = baseLeadWhere(rule({ stage: 'CLOSED_WON' }), { excludeWon: true });
  assert.equal(where.stage, 'CLOSED_WON');
});

test('the once-per-lead-ever guard is not disturbed by the stage filter', () => {
  for (const opts of [undefined, { excludeWon: true }]) {
    const where = baseLeadWhere(rule({ stage: 'any' }), opts);
    assert.deepEqual(where.automationRuns, { none: { ruleId: 'rule-1' } });
    assert.equal(where.tenantId, 'tenant-1');
  }
});
