// test/handoff-triggers.test.js
//
// Unit tests for the Settings.jsx "payment" and "legal" handoff-rule
// detectors in claude.service.js. Pure functions, no OpenAI call and no DB —
// runs in milliseconds, no API key or Postgres required.
//
// Exists because these two rules were previously either English-only
// (payment) or entirely unimplemented (legal) — a tenant could turn on
// "escalate on legal threat" in Settings and it would silently do nothing.
// This is the regression guard: it fails loudly if a future edit narrows
// the pattern back to English-only, or if legal detection gets deleted
// again.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// config/env.js Zod-validates these at module load and crashes the process
// if any is missing — required here purely so requiring claude.service.js
// (which constructs an OpenAI client at load time) doesn't throw before the
// pure functions under test are even reached. No network call is made by
// the functions this file exercises.
Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(32),
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'y'.repeat(32),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'sk-test',
});

const { detectPaymentDispute, detectLegalThreat } = require('../src/services/claude.service');

test('detects payment disputes in English', () => {
  assert.ok(detectPaymentDispute('I want a refund, this is a scam'));
  assert.ok(detectPaymentDispute('this looks like a chargeback situation'));
  assert.ok(detectPaymentDispute('my payment failed but you still charged me'));
});

test('detects payment disputes in Roman Urdu', () => {
  assert.ok(detectPaymentDispute('mujhe paisay wapis chahiye, ye fraud hai'));
  assert.ok(detectPaymentDispute('aap ne galat charge kar diya mera account'));
  assert.ok(detectPaymentDispute('paise wapas karo abhi'));
});

test('does not flag an ordinary price question as a payment dispute', () => {
  // The exact "price objection" examples from QUALIFIER_SCHEMA's own prompt —
  // these must stay false, or every fee question in this bilingual product
  // would wrongly force a human handoff.
  assert.equal(detectPaymentDispute('fee kya hai'), false);
  assert.equal(detectPaymentDispute('expensive lagta hai'), false);
  assert.equal(detectPaymentDispute('mehnga hai thoda'), false);
  assert.equal(detectPaymentDispute('installment mein ho sakta hai?'), false);
});

test('detects legal threats and complaints — the toggle that previously did nothing', () => {
  assert.ok(detectLegalThreat('I will sue you if this is not resolved'));
  assert.ok(detectLegalThreat('mera vakeel se baat karwaunga'));
  assert.ok(detectLegalThreat('main FBR mein shikayat karonga'));
  assert.ok(detectLegalThreat('this is going to consumer complaint next'));
});

test('does not flag ordinary conversation as a legal threat', () => {
  assert.equal(detectLegalThreat('is this course good for beginners?'), false);
  assert.equal(detectLegalThreat('haan mujhe interest hai'), false);
});

test('empty or missing message never matches either detector', () => {
  assert.equal(detectPaymentDispute(''), false);
  assert.equal(detectPaymentDispute(undefined), false);
  assert.equal(detectLegalThreat(''), false);
  assert.equal(detectLegalThreat(undefined), false);
});
