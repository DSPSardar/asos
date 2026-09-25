// Pins the single definition of "enrolled student" — see
// src/services/enrollment.definition.js. Run: node --test test/
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';

const test = require('node:test');
const assert = require('node:assert');
const { dedupeByContact, feeOf, paidWonWhere } = require('../src/services/enrollment.definition');

test('one person with two paid won leads counts once, at the latest fee', () => {
  const rows = dedupeByContact([
    { contactId: 'a', closedAt: new Date('2026-08-01'), dealValue: 10000 },
    { contactId: 'a', closedAt: new Date('2026-09-01'), dealValue: 28000 },
    { contactId: 'b', closedAt: new Date('2026-09-02'), dealValue: 28000 },
  ]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows.reduce((s, l) => s + feeOf(l), 0), 56000);
});

test('enrollmentFee wins over dealValue; zero / null fee is not revenue', () => {
  assert.strictEqual(feeOf({ enrollmentFee: '28000.00', dealValue: '10000' }), 28000);
  assert.strictEqual(feeOf({ enrollmentFee: null, dealValue: null }), 0);
  assert.strictEqual(feeOf({ dealValue: 0 }), 0);
});

test('paid-won filter requires CLOSED_WON and a fee > 0 on either column', () => {
  const w = paidWonWhere('t1');
  assert.strictEqual(w.stage, 'CLOSED_WON');
  assert.deepStrictEqual(w.OR, [{ dealValue: { gt: 0 } }, { enrollmentFee: { gt: 0 } }]);
});
