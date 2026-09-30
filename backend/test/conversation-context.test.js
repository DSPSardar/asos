// test/conversation-context.test.js
//
// Bounded AI context: the loader fetches a window instead of the whole
// thread, the Closer's lead-message count still covers the whole thread, and
// older messages are collapsed into a rolling summary on the lead — with no
// gap between the summary's end and the verbatim window.
'use strict';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { installFakePrisma } = require('./_fakePrisma');
const db = installFakePrisma();

const ctx = require('../src/utils/conversationContext');
const { PAYMENT_DETAILS_PLACEHOLDER } = require('../src/utils/aiHistory');

const BANK = 'Meezan Bank\nAccount: 0101-2345678-9';
const t0 = Date.UTC(2026, 8, 1);

// n messages alternating CONTACT (odd) / AI (even): m1 … mN.
const seed = (n, { lead = {} } = {}) => {
  db._tables.lead.push({ id: 'l1', tenantId: 't1', stage: 'QUALIFYING', historySummary: null, historySummaryCount: 0, historySummaryConversationId: null, ...lead });
  for (let i = 1; i <= n; i += 1) {
    db._tables.message.push({
      id: `m${i}`, tenantId: 't1', conversationId: 'c1', sentAt: new Date(t0 + i * 60_000),
      sender: i % 2 ? 'CONTACT' : 'AI', direction: i % 2 ? 'INBOUND' : 'OUTBOUND', type: 'TEXT', content: `msg ${i}`,
    });
  }
};
const lead = () => db._tables.lead[0];
const load = (over = {}) => ctx.loadConversationContext({ tenantId: 't1', conversationId: 'c1', lead: lead(), ...over });

beforeEach(() => { for (const t of Object.values(db._tables)) t.length = 0; });

test('no summary: newest 20, oldest→newest, and the lead-message count covers the WHOLE thread', async () => {
  seed(120);
  const c = await load();
  assert.equal(c.messageHistory.length, 20);
  assert.equal(c.messageHistory[0].id, 'm101');
  assert.equal(c.messageHistory.at(-1).id, 'm120');
  assert.equal(c.contactMessageCount, 60);
  assert.equal(c.earlierSummary, null);
});

test('excludeMessageId drops the message being answered from both history and count', async () => {
  seed(121);                                             // m121 is the inbound being answered
  const c = await load({ excludeMessageId: 'm121' });
  assert.equal(c.messageHistory.at(-1).id, 'm120');
  assert.equal(c.contactMessageCount, 60);
});

test('outbound voice-note twins are excluded; inbound audio stays', async () => {
  seed(4);
  db._tables.message.push({ id: 'a1', tenantId: 't1', conversationId: 'c1', sentAt: new Date(t0 + 10 * 60_000), sender: 'AI', direction: 'OUTBOUND', type: 'AUDIO', content: 'msg 4' });
  db._tables.message.push({ id: 'a2', tenantId: 't1', conversationId: 'c1', sentAt: new Date(t0 + 11 * 60_000), sender: 'CONTACT', direction: 'INBOUND', type: 'AUDIO', content: 'voice transcript' });
  const ids = (await load()).messageHistory.map((m) => m.id);
  assert.ok(!ids.includes('a1'));
  assert.ok(ids.includes('a2'));
});

test('with a summary, the window starts exactly where the summary ends (no gap), never below 20', async () => {
  seed(120, { lead: { historySummary: 'S', historySummaryCount: 92, historySummaryConversationId: 'c1' } });
  const c = await load();
  assert.equal(c.earlierSummary, 'S');
  assert.equal(c.messageHistory[0].id, 'm93');           // 92 summarized → verbatim from 93
  assert.equal(c.messageHistory.length, 28);
  lead().historySummaryCount = 110;                      // summary overlaps the last 20
  const d = await load();
  assert.equal(d.messageHistory.length, 20);
  assert.equal(d.messageHistory[0].id, 'm101');
});

test("a summary written for a different conversation is ignored", async () => {
  seed(60, { lead: { historySummary: 'other', historySummaryCount: 30, historySummaryConversationId: 'c-old' } });
  const c = await load();
  assert.equal(c.earlierSummary, null);
  assert.equal(c.messageHistory.length, 20);
});

test('payment details are redacted in the loaded history', async () => {
  seed(3);
  db._tables.message.push({ id: 'p1', tenantId: 't1', conversationId: 'c1', sentAt: new Date(t0 + 9 * 60_000), sender: 'AI', direction: 'OUTBOUND', type: 'TEXT', content: BANK });
  const c = await load({ paymentDetails: BANK });
  assert.equal(c.messageHistory.at(-1).content, PAYMENT_DETAILS_PLACEHOLDER);
});

// ── Rolling summary refresh ──────────────────────────────────────────

const summarizer = () => {
  const calls = [];
  const fn = async ({ messageHistory, priorSummary }) => { calls.push({ ids: messageHistory.map((m) => m.id), contents: messageHistory.map((m) => m.content), priorSummary }); return `summary#${calls.length}`; };
  return { calls, fn };
};
const refresh = (summarize, over = {}) => ctx.refreshSummaryIfDue({ tenantId: 't1', conversationId: 'c1', lead: lead(), summarize, ...over });

test('not due while fewer than 10 un-summarized messages sit outside the 20-message window', async () => {
  seed(29);                                              // 9 outside
  const s = summarizer();
  assert.equal(await refresh(s.fn), false);
  assert.equal(s.calls.length, 0);
});

test('first refresh summarizes everything older than the window; the next one is incremental', async () => {
  seed(30);                                              // 10 outside → due
  const s = summarizer();
  assert.equal(await refresh(s.fn), true);
  assert.deepEqual(s.calls[0].ids, ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10']);
  assert.equal(s.calls[0].priorSummary, null);
  assert.equal(lead().historySummary, 'summary#1');
  assert.equal(lead().historySummaryCount, 10);
  assert.equal(lead().historySummaryConversationId, 'c1');
  assert.ok(lead().historySummaryAt instanceof Date);

  for (let i = 31; i <= 39; i += 1) db._tables.message.push({ id: `m${i}`, tenantId: 't1', conversationId: 'c1', sentAt: new Date(t0 + i * 60_000), sender: 'CONTACT', direction: 'INBOUND', type: 'TEXT', content: `msg ${i}` });
  assert.equal(await refresh(s.fn), false);              // 19 outside, 10 summarized → 9 new

  db._tables.message.push({ id: 'm40', tenantId: 't1', conversationId: 'c1', sentAt: new Date(t0 + 40 * 60_000), sender: 'AI', direction: 'OUTBOUND', type: 'TEXT', content: 'msg 40' });
  assert.equal(await refresh(s.fn), true);
  assert.deepEqual(s.calls[1].ids, ['m11', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19', 'm20']);
  assert.equal(s.calls[1].priorSummary, 'summary#1');
  assert.equal(lead().historySummaryCount, 20);
});

test('bank details never reach the summarizer', async () => {
  seed(30);
  db._tables.message.find((m) => m.id === 'm4').content = BANK;
  const s = summarizer();
  await refresh(s.fn, { paymentDetails: BANK });
  assert.ok(!s.calls[0].contents.includes(BANK));
  assert.ok(s.calls[0].contents.includes(PAYMENT_DETAILS_PLACEHOLDER));
});

test('a failed summarizer leaves the old summary intact and reports false', async () => {
  seed(30, { lead: { historySummary: 'keep me', historySummaryCount: 0, historySummaryConversationId: 'c1' } });
  const ok = await refresh(async () => { throw new Error('model down'); });
  assert.equal(ok, false);
  assert.equal(lead().historySummary, 'keep me');
});
