// test/form-submitted.test.js
//
// Item 3 — "already filled the form" backstop. A payment-pending lead who
// says they submitted the enrolment form gets the fixed "registration in
// process" reply; formSubmittedAt is stamped and reminders stop.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectFormSubmitted, isPaymentPending, FORM_SUBMITTED_REPLY } = require('../src/services/agent-guards/form-submitted');

test('detects form-submitted in Roman Urdu and English', () => {
  for (const m of [
    'form fill kar diya', 'Form fill kr dia hai sir', 'maine form bhar diya', 'form submit kar diya',
    'submitted', 'I have registered', 'registration done', 'Done ✅', 'registered', 'form bhej diya',
    'I filled the form', 'main ne register kar liya',
  ]) assert.ok(detectFormSubmitted(m), `should match: ${m}`);
});

test('detects form-submitted in Urdu script', () => {
  assert.ok(detectFormSubmitted('میں نے فارم بھر دیا ہے'));
  assert.ok(detectFormSubmitted('رجسٹر کر دیا'));
});

test('does not fire on payment claims, questions, or plain acknowledgements', () => {
  for (const m of ['payment kar diya', 'screenshot bhej raha hun', 'fee kya hai', 'ok', 'yes', 'form kahan hai?', 'form ka link bhejein', 'kya form bharna zaroori hai']) {
    assert.equal(detectFormSubmitted(m), false, `should NOT match: ${m}`);
  }
});

test('payment-pending means PROPOSED, or details sent, or a proof received — never a closed lead', () => {
  assert.ok(isPaymentPending({ lead: { stage: 'PROPOSED' }, conversation: {} }));
  assert.ok(isPaymentPending({ lead: { stage: 'DIAGNOSED' }, conversation: { paymentDetailsSentAt: new Date() } }));
  assert.ok(isPaymentPending({ lead: { stage: 'QUALIFYING' }, conversation: { paymentProofDetected: true } }));
  assert.equal(isPaymentPending({ lead: { stage: 'QUALIFYING' }, conversation: {} }), false);
  assert.equal(isPaymentPending({ lead: { stage: 'CLOSED_WON' }, conversation: { paymentProofDetected: true } }), false);
  assert.equal(isPaymentPending({ lead: { stage: 'CLOSED_LOST' }, conversation: { paymentDetailsSentAt: new Date() } }), false);
});

test('the fixed reply says registration is in process and sign-in details arrive by email + WhatsApp', () => {
  assert.match(FORM_SUBMITTED_REPLY, /registration/i);
  assert.match(FORM_SUBMITTED_REPLY, /email/i);
  assert.match(FORM_SUBMITTED_REPLY, /WhatsApp/i);
  assert.match(FORM_SUBMITTED_REPLY, /sign-in/i);
  // Never a pitch, never a price.
  assert.doesNotMatch(FORM_SUBMITTED_REPLY, /28,?000|\$100|seat/i);
});

test('the worker stamps formSubmittedAt, cancels sequences and returns before the AI runs', () => {
  const src = require('fs').readFileSync(require.resolve('../src/workers/conversation.worker'), 'utf8');
  const i = src.indexOf('formSubmitted.detectFormSubmitted(content)');
  assert.ok(i > 0, 'worker calls detectFormSubmitted');
  const block = src.slice(i, i + 1400);
  assert.match(block, /formSubmittedAt: new Date\(\)/);
  assert.match(block, /cancelSequencesForLead\(lead\.id, 'form_submitted'\)/);
  assert.match(block, /FORM_SUBMITTED_REPLY/);
  assert.match(block, /return;/);
  // …and it runs before the Qualifier/Closer call.
  assert.ok(i < src.indexOf('claudeService.processMessage({'));
});
