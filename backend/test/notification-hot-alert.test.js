// test/notification-hot-alert.test.js
//
// Pure unit tests for the hot-lead alert upgrade (Phase 2 of the AI Sales
// Employee rollout): quiet-hours evaluation and the enriched hotLead message.
// No network, no DB — buildMessage and inQuietHours are pure functions.

// notification.service pulls in whatsapp.service → env-validating config at
// require time; these placeholders are never used because nothing here sends.
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMessage, inQuietHours, minutesOfDay } = require('../src/services/notification.service');

// A UTC instant whose Asia/Karachi local time is 02:30 (UTC+5 → 21:30 UTC
// previous day). PKT has no DST, so this is stable year-round.
const PKT_0230 = new Date('2026-01-15T21:30:00Z');
// Asia/Karachi local time 14:00.
const PKT_1400 = new Date('2026-01-15T09:00:00Z');

test('quiet hours: disabled, absent, or malformed configs never suppress', () => {
  assert.equal(inQuietHours(undefined, PKT_0230), false);
  assert.equal(inQuietHours(null, PKT_0230), false);
  assert.equal(inQuietHours({ enabled: false, start: '23:00', end: '08:00' }, PKT_0230), false);
  assert.equal(inQuietHours({ enabled: true, start: 'nonsense', end: '08:00' }, PKT_0230), false);
  assert.equal(inQuietHours({ enabled: true, start: '23:00', end: '23:00' }, PKT_0230), false); // zero-length
  assert.equal(inQuietHours({ enabled: true, start: '23:00', end: '08:00', tz: 'Not/AZone' }, PKT_0230), false);
});

test('quiet hours: overnight window (23:00–08:00 PKT) catches 02:30 and releases 14:00', () => {
  const qh = { enabled: true, start: '23:00', end: '08:00', tz: 'Asia/Karachi' };
  assert.equal(inQuietHours(qh, PKT_0230), true);
  assert.equal(inQuietHours(qh, PKT_1400), false);
});

test('quiet hours: same-day window and tz default to Asia/Karachi', () => {
  // 13:00–15:00 PKT window; 14:00 PKT is inside, 02:30 PKT is not.
  const qh = { enabled: true, start: '13:00', end: '15:00' }; // no tz → PKT default
  assert.equal(inQuietHours(qh, PKT_1400), true);
  assert.equal(inQuietHours(qh, PKT_0230), false);
  // Same instant evaluated in UTC (09:00) is outside a 13:00–15:00 UTC window.
  assert.equal(inQuietHours({ ...qh, tz: 'UTC' }, PKT_1400), false);
});

test('minutesOfDay parses HH:MM and rejects garbage', () => {
  assert.equal(minutesOfDay('08:30'), 510);
  assert.equal(minutesOfDay('23:59'), 1439);
  assert.equal(minutesOfDay('24:00'), null);
  assert.equal(minutesOfDay('8:75'), null);
  assert.equal(minutesOfDay(''), null);
  assert.equal(minutesOfDay(undefined), null);
});

test('hotLead message carries the briefing pack when the Qualifier produced one', () => {
  const msg = buildMessage('hotLead', {
    contactName: 'Ayesha',
    phone: '923001234567',
    score: 9,
    problemSummary: 'Wants to automate clinic bookings, losing walk-ins',
    nextAction: 'Offer the Thursday demo slot',
    urgencyTrigger: 'Competitor quoted her yesterday',
    conversationUrl: 'https://dspagenthub.com/conversations?id=abc-123',
  }, { name: 'DSP' });

  assert.match(msg, /HOT Lead Alert — DSP/);
  assert.match(msg, /Ayesha/);
  assert.match(msg, /Score: 9\/10/);
  assert.match(msg, /Problem: Wants to automate clinic bookings/);
  assert.match(msg, /Urgency: Competitor quoted her yesterday/);
  assert.match(msg, /Suggested next step: Offer the Thursday demo slot/);
  assert.match(msg, /https:\/\/dspagenthub\.com\/conversations\?id=abc-123/);
});

test('hotLead message degrades gracefully when enrichment fields are absent', () => {
  const msg = buildMessage('hotLead', {
    contactName: 'Bilal', phone: '923009999999', score: 8,
  }, { name: 'DSP' });

  assert.match(msg, /Score: 8\/10/);
  assert.doesNotMatch(msg, /Problem:/);
  assert.doesNotMatch(msg, /Suggested next step:/);
  // Falls back to the original call-to-action line instead of a dead link.
  assert.match(msg, /ready to close/i);
});

test('other event messages are unchanged in shape', () => {
  const t = { name: 'DSP' };
  assert.match(buildMessage('newLead', { contactName: 'X', phone: '92300' }, t), /New Lead — DSP/);
  assert.match(buildMessage('needsHuman', { contactName: 'X', phone: '92300', reason: 'r' }, t), /Human Handoff — DSP/);
  assert.match(buildMessage('unansweredQuestion', { contactName: 'X', phone: '92300', question: 'q' }, t), /Knowledge Gap — DSP/);
});
