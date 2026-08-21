// test/ai-history-redaction.test.js
//
// The payment-details block is stored as a normal outbound Message (right,
// for the dashboard and audit trail) — but that meant every later AI turn
// shipped the bank account numbers to the LLM provider inside conversation
// history. sanitizeHistoryForAI() is the single choke point that redacts it
// on every AI-bound path (worker pipeline, summary, suggested reply).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeHistoryForAI, PAYMENT_DETAILS_PLACEHOLDER } = require('../src/utils/aiHistory');

const DETAILS = 'Meezan Bank\nIBAN: PK36MEZN0000110123456789\nTitle: DSP (Pvt) Ltd';

test('the payment-details message is replaced with the placeholder', () => {
  const out = sanitizeHistoryForAI(
    [
      { sender: 'CONTACT', content: 'payment kaise karon?' },
      { sender: 'AI', content: DETAILS },
      { sender: 'CONTACT', content: 'done, screenshot bhejta hun' },
    ],
    DETAILS
  );
  assert.equal(out[1].content, PAYMENT_DETAILS_PLACEHOLDER);
  assert.ok(!JSON.stringify(out).includes('PK36MEZN'), 'no account digits survive');
});

test('whitespace differences between config and stored message still match', () => {
  const out = sanitizeHistoryForAI([{ content: `  ${DETAILS}\n` }], DETAILS);
  assert.equal(out[0].content, PAYMENT_DETAILS_PLACEHOLDER);
});

test('ordinary messages pass through untouched', () => {
  const msgs = [{ content: 'Fee kya hai?' }, { content: null }, { content: 'ok' }];
  assert.deepEqual(sanitizeHistoryForAI(msgs, DETAILS), msgs);
});

test('no configured payment details → history is returned as-is', () => {
  const msgs = [{ content: 'hello' }];
  assert.equal(sanitizeHistoryForAI(msgs, null), msgs);
  assert.equal(sanitizeHistoryForAI(msgs, '   '), msgs);
});

test('does not mutate the input rows', () => {
  const row = { content: DETAILS };
  sanitizeHistoryForAI([row], DETAILS);
  assert.equal(row.content, DETAILS);
});
