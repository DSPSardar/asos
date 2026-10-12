const test = require('node:test');
const assert = require('node:assert');
const { isQuietHours } = require('../src/services/automation.steps');

const pkt = (h) => new Date(Date.UTC(2026, 9, 13, (h - 5 + 24) % 24, 30)); // HH:30 in Karachi
const t = { settings: { quietHours: { start: 22, end: 9, tz: 'Asia/Karachi' } } };

test('no setting = never quiet (other tenants unchanged)', () => {
  assert.equal(isQuietHours({ settings: {} }, pkt(1)), false);
  assert.equal(isQuietHours(null, pkt(1)), false);
});
test('22:00-09:00 Karachi is quiet, across midnight', () => {
  for (const h of [22, 23, 0, 1, 5, 8]) assert.equal(isQuietHours(t, pkt(h)), true, `hour ${h}`);
  for (const h of [9, 12, 18, 21]) assert.equal(isQuietHours(t, pkt(h)), false, `hour ${h}`);
});
test('same-day window works too', () => {
  const d = { settings: { quietHours: { start: 13, end: 14, tz: 'Asia/Karachi' } } };
  assert.equal(isQuietHours(d, pkt(13)), true);
  assert.equal(isQuietHours(d, pkt(14)), false);
});
