// test/hard-escalation.test.js
//
// Item 6 — hard escalation is independent of the dashboard toggles and is
// limited to: refund / dispute / chargeback, complaint / legal / FBR / fraud,
// an explicit ask for a human or Sardar, two consecutive negative messages.
// Fee / payment / screenshot / "paid" / "transaction" never escalate alone.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const esc = require('../src/services/agent-guards/escalation');

test('refund / dispute / chargeback → human', () => {
  for (const m of ['I want a refund', 'this is a dispute, chargeback coming', 'paisay wapis karo', 'aap ne mujhe galat charge kiya', 'you charged me twice', 'رقم واپس کریں']) {
    assert.equal(esc.detectHardEscalation(m).kind, 'refund_dispute', m);
  }
});

test('complaint / legal / FBR / fraud → human', () => {
  for (const m of ['I will take legal action', 'mera vakeel baat karega', 'main FBR mein shikayat karonga', 'ye fraud hai', 'this is a scam', 'consumer court', 'شکایت کروں گا']) {
    assert.equal(esc.detectHardEscalation(m).kind, 'complaint_legal', m);
  }
});

test('an explicit request for a human or for Sardar → human, with Sardar\'s number in the reply', () => {
  for (const m of ['can I talk to a human please', 'mujhe Sardar se baat karni hai', 'Sardar sir se baat karwa dein', 'kisi bande se baat karwao', 'is this a bot? I want a real person', 'سردار سے بات کروائیں']) {
    assert.equal(esc.detectHardEscalation(m).kind, 'human_requested', m);
  }
  assert.ok(esc.HUMAN_REQUEST_REPLY.includes(esc.SARDAR_WHATSAPP));
  assert.equal(esc.SARDAR_WHATSAPP, '+92 311 8122222');
});

test('fee / payment / screenshot / paid / transaction NEVER escalate on their own', () => {
  for (const m of [
    'fee kya hai', 'fee kitni hai?', 'payment kaise karni hai', 'payment kar di hai', 'screenshot bhej raha hun',
    'paid', 'I have paid, here is the transaction id 12345', 'transaction done', 'payment failed, kya karun?',
    'mehnga hai', 'installment ho sakti hai?', 'bank account bhejein', 'jazzcash se payment ho jayegi?',
  ]) {
    assert.equal(esc.detectHardEscalation(m).escalate, false, `should NOT escalate: ${m}`);
  }
});

test('two consecutive negative messages escalate; one does not', () => {
  assert.equal(esc.isConsecutiveNegative('NEGATIVE', 'NEGATIVE'), true);
  assert.equal(esc.isConsecutiveNegative('NEUTRAL', 'NEGATIVE'), false);
  assert.equal(esc.isConsecutiveNegative(null, 'NEGATIVE'), false);
  assert.equal(esc.isConsecutiveNegative('NEGATIVE', 'POSITIVE'), false);
});

test('the pipeline runs hard escalation before any toggle is consulted', () => {
  const src = require('fs').readFileSync(require.resolve('../src/services/claude.service'), 'utf8');
  const hard = src.indexOf('escalation.detectHardEscalation(newMessage)');
  const rules = src.indexOf('aiConfig.handoffRules');
  assert.ok(hard > 0 && hard < rules, 'hard escalation precedes the handoffRules read');
  // The old "payment" toggle no longer gates a refund escalation.
  assert.doesNotMatch(src, /rules\.payment !== false && detectPaymentDispute/);
  assert.doesNotMatch(src, /rules\.legal !== false && detectLegalThreat/);
});

test('"already enrolled" and opt-out detectors (suppression-list inputs)', () => {
  assert.ok(esc.detectAlreadyEnrolled('main pehle se enrolled hun'));
  assert.ok(esc.detectAlreadyEnrolled('I am already a student'));
  assert.ok(esc.detectAlreadyEnrolled('already registered, thanks'));
  assert.equal(esc.detectAlreadyEnrolled('I want to enroll'), false);
  assert.ok(esc.detectOptOut('STOP'));
  assert.ok(esc.detectOptOut('mujhe message mat karo'));
  assert.ok(esc.detectOptOut('unsubscribe'));
  assert.equal(esc.detectOptOut('stop kab hoga course?'), false);
  assert.equal(esc.detectOptOut('please stop by our office'), false);
});
