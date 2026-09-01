// test/daily-digest.test.js
//
// Pure unit tests for the 09:00 daily digest's selection logic
// (services/dailyDigest.service.js). No DB, no network, no Redis: every
// function under test takes already-loaded rows and returns a decision.
//
// What is pinned here:
//   - who lands in today's call list (open HOT leads only, score order)
//   - the follow-up split: "awaiting our reply" vs "we spoke last, gone quiet"
//   - what counts as stalled (per-stage thresholds, the cold ceiling, the
//     updatedAt fallback for leads that predate lead_stage_history)
//   - the HOT-only filter on the quiet and stalled sections
//   - yesterday's wins count paid leads only
//   - the ranking of today's 3 actions
//   - the empty-state path renders one line, not a wall of zeros
//   - the WhatsApp params never carry newlines (Meta rejects them)
//   - the notifPrefs.daily gate
'use strict';

// The service pulls in the env-validating config at require time; these
// placeholders are never used because nothing here queries or sends.
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';
process.env.APP_URL ||= 'https://dashboard.example.test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/services/dailyDigest.service');

// 09:00 Asia/Karachi on 2026-09-02 == 04:00Z.
const NOW = new Date('2026-09-02T04:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000);
const daysAgo = (n) => hoursAgo(n * 24);

// Each lead gets its own phone unless the test says otherwise — the digest
// dedupes by contact, so shared phones would collapse rows.
let phoneSeq = 0;
const nextPhone = () => `92300${String(++phoneSeq).padStart(7, '0')}`;

const lead = (over = {}) => ({
  id: over.id || `lead-${Math.random().toString(36).slice(2, 8)}`,
  stage: 'QUALIFYING', scoreLabel: 'WARM', aiScore: 50, nextAction: 'continue_qualifying',
  problemSummary: null, qualificationData: {}, updatedAt: hoursAgo(1), enrollmentFee: null,
  contact: { name: 'Test Lead', phone: nextPhone(), email: null },
  conversations: [{ id: `conv-${over.id || 'x'}`, status: 'AI_HANDLING', aiEnabled: true, lastMessageAt: hoursAgo(1), messages: [] }],
  ...over,
});

const conv = (over = {}) => ({
  id: over.id || `conv-${Math.random().toString(36).slice(2, 8)}`,
  status: 'AI_HANDLING', aiEnabled: true, lastMessageAt: hoursAgo(1),
  lead: { id: 'l', stage: 'QUALIFYING', aiScore: 50, scoreLabel: 'WARM', contact: { name: 'Someone', phone: nextPhone() } },
  messages: [{ direction: 'INBOUND', sentAt: hoursAgo(1) }],
  ...over,
});

const emptySections = () => ({
  now: NOW, newLeads: [], callList: [],
  followUps: { awaiting: [], awaitingTotal: 0, quiet: [], quietTotal: 0 },
  stalled: { items: [], total: 0 },
  wins: { count: 0, total: 0, currency: 'PKR', leads: [] },
  needsEmail: [],
});

// ── PKT day math ─────────────────────────────────────────────────────

test('pkt day key and bounds follow Asia/Karachi, not UTC', () => {
  // 02:00 PKT on the 2nd is still the 1st in UTC.
  const early = new Date('2026-09-01T21:00:00Z');
  assert.equal(d.pktDayKey(early), '2026-09-02');
  const { todayStart, yesterdayStart } = d.pktDayBounds(NOW);
  assert.equal(todayStart.toISOString(), '2026-09-01T19:00:00.000Z');     // 00:00 PKT 2 Sep
  assert.equal(yesterdayStart.toISOString(), '2026-08-31T19:00:00.000Z'); // 00:00 PKT 1 Sep
});

// ── Call list ────────────────────────────────────────────────────────

test('call list: open HOT leads only, highest score first, capped', () => {
  const rows = [
    lead({ id: 'warm', scoreLabel: 'WARM', aiScore: 95 }),
    lead({ id: 'won', scoreLabel: 'HOT', aiScore: 99, stage: 'CLOSED_WON' }),
    lead({ id: 'lost', scoreLabel: 'HOT', aiScore: 98, stage: 'CLOSED_LOST' }),
    lead({ id: 'h80', scoreLabel: 'HOT', aiScore: 80 }),
    lead({ id: 'h90', scoreLabel: 'HOT', aiScore: 90 }),
    lead({ id: 'h85', scoreLabel: 'HOT', aiScore: 85 }),
  ];
  const list = d.selectCallList(rows, { limit: 2 });
  assert.deepEqual(list.map((l) => l.id), ['h90', 'h85']);
  assert.equal(d.selectCallList(rows).length, 3);
});

test('call list: same score → most recently active first', () => {
  const rows = [
    lead({ id: 'old', scoreLabel: 'HOT', aiScore: 90, conversations: [{ id: 'c1', lastMessageAt: daysAgo(3), messages: [] }] }),
    lead({ id: 'fresh', scoreLabel: 'HOT', aiScore: 90, conversations: [{ id: 'c2', lastMessageAt: hoursAgo(2), messages: [] }] }),
  ];
  assert.equal(d.selectCallList(rows, { now: NOW })[0].id, 'fresh');
});

test('call list: a HOT lead active this week outranks a higher-scored one that vanished two weeks ago', () => {
  const rows = [
    lead({ id: 'ghost', scoreLabel: 'HOT', aiScore: 100, conversations: [{ id: 'c1', lastMessageAt: daysAgo(13), messages: [] }] }),
    lead({ id: 'live', scoreLabel: 'HOT', aiScore: 80, conversations: [{ id: 'c2', lastMessageAt: daysAgo(2), messages: [] }] }),
  ];
  assert.deepEqual(d.selectCallList(rows, { now: NOW }).map((l) => l.id), ['live', 'ghost']);
});

test('call list and lists dedupe duplicate lead rows for the same phone', () => {
  const rows = [
    lead({ id: 'a', scoreLabel: 'HOT', aiScore: 100, contact: { name: 'Saam', phone: '971555810190' } }),
    lead({ id: 'b', scoreLabel: 'HOT', aiScore: 100, contact: { name: 'Saam', phone: '971555810190' } }),
    lead({ id: 'c', scoreLabel: 'HOT', aiScore: 90, contact: { name: 'Other', phone: '923000000001' } }),
  ];
  assert.deepEqual(d.selectCallList(rows, { now: NOW }).map((l) => l.id), ['a', 'c']);
  assert.equal(d.dedupeByContact(rows).length, 2);
});

test('opener is derived from lead data, never blank, and carries the urgency trigger', () => {
  const closing = lead({ nextAction: 'close_deal', qualificationData: { lastUrgencyTrigger: 'batch closes Friday' } });
  assert.match(d.buildOpener(closing), /lock their seat/);
  assert.match(d.buildOpener(closing), /batch closes Friday/);
  assert.match(d.buildOpener(lead({ nextAction: 'send_proposal' })), /payment details/);
  assert.match(d.buildOpener(lead({ nextAction: 'nurture' })), /No pitch/);
  const asked = lead({ nextAction: 'continue_qualifying' });
  asked.conversations[0].messages = [{ content: 'QR se pay kar sakta hoon?', sentAt: hoursAgo(1) }];
  assert.match(d.buildOpener(asked), /Answer what they last asked/);
  assert.ok(d.buildOpener(lead({ nextAction: null })).length > 20);
});

test('problem line prefers the Qualifier summary, falls back to the lead\'s own last message', () => {
  assert.equal(d.problemLine(lead({ problemSummary: 'Needs a job in 3 months' })), 'Needs a job in 3 months');
  const l = lead({ problemSummary: null });
  l.conversations[0].messages = [{ content: 'fees kitni hai?', sentAt: hoursAgo(1) }];
  assert.equal(d.problemLine(l), 'fees kitni hai?');
  assert.match(d.problemLine(lead({ problemSummary: null })), /No summary yet/);
});

// ── Follow-up queue ──────────────────────────────────────────────────

test('follow-ups: payment proof waiting and unanswered handoffs are "awaiting"', () => {
  const rows = [
    conv({ id: 'pv', status: 'PENDING_VERIFICATION', messages: [{ direction: 'OUTBOUND' }] }),
    conv({ id: 'ht-theirs', status: 'HUMAN_TAKEOVER', messages: [{ direction: 'INBOUND' }] }),
    conv({ id: 'ht-ours', status: 'HUMAN_TAKEOVER', messages: [{ direction: 'OUTBOUND' }] }),
    conv({ id: 'aioff-theirs', aiEnabled: false, messages: [{ direction: 'INBOUND' }] }),
    conv({ id: 'ai-theirs', aiEnabled: true, messages: [{ direction: 'INBOUND' }] }), // AI will answer
  ];
  const { awaiting, awaitingTotal } = d.splitFollowUps(rows, NOW);
  assert.deepEqual(awaiting.map((c) => c.id), ['pv', 'ht-theirs', 'aioff-theirs']);
  assert.equal(awaitingTotal, 3);
});

test('follow-ups: "gone quiet" needs OUR last message, 48h+ silence, an open lead, inside the lookback', () => {
  const rows = [
    conv({ id: 'quiet', lastMessageAt: hoursAgo(50), messages: [{ direction: 'OUTBOUND' }] }),
    conv({ id: 'recent', lastMessageAt: hoursAgo(20), messages: [{ direction: 'OUTBOUND' }] }),
    conv({ id: 'theirs', lastMessageAt: hoursAgo(50), messages: [{ direction: 'INBOUND' }] }),
    conv({ id: 'won', lastMessageAt: hoursAgo(50), messages: [{ direction: 'OUTBOUND' }], lead: { stage: 'CLOSED_WON', aiScore: 90, contact: {} } }),
    conv({ id: 'lost', lastMessageAt: hoursAgo(50), messages: [{ direction: 'OUTBOUND' }], lead: { stage: 'CLOSED_LOST', aiScore: 90, contact: {} } }),
    conv({ id: 'ancient', lastMessageAt: daysAgo(20), messages: [{ direction: 'OUTBOUND' }] }),
    conv({ id: 'closedconv', status: 'CLOSED', lastMessageAt: hoursAgo(50), messages: [{ direction: 'OUTBOUND' }] }),
  ];
  const { quiet, quietTotal } = d.splitFollowUps(rows, NOW, { hotOnly: false });
  assert.deepEqual(quiet.map((c) => c.id), ['quiet']);
  assert.equal(quietTotal, 1);
});

test('follow-ups: awaiting puts freshest payment proof first, then longest-waiting replies; quiet puts hottest first; both cap and report totals', () => {
  const awaitingRows = [
    conv({ id: 'a-old', status: 'HUMAN_TAKEOVER', lastMessageAt: hoursAgo(30), messages: [{ direction: 'INBOUND' }], lead: { stage: 'QUALIFYING', aiScore: 50, contact: { phone: '1' } } }),
    conv({ id: 'a-pv-stale', status: 'PENDING_VERIFICATION', lastMessageAt: daysAgo(10), lead: { stage: 'PROPOSED', aiScore: 50, contact: { phone: '2' } } }),
    conv({ id: 'a-pv', status: 'PENDING_VERIFICATION', lastMessageAt: hoursAgo(2), lead: { stage: 'PROPOSED', aiScore: 50, contact: { phone: '3' } } }),
    conv({ id: 'a-new', status: 'HUMAN_TAKEOVER', lastMessageAt: hoursAgo(3), messages: [{ direction: 'INBOUND' }], lead: { stage: 'QUALIFYING', aiScore: 50, contact: { phone: '4' } } }),
  ];
  const quietRows = Array.from({ length: 12 }, (_, i) => conv({
    id: `q${i}`, lastMessageAt: hoursAgo(60), messages: [{ direction: 'OUTBOUND' }],
    lead: { stage: 'PROPOSED', aiScore: i * 5, contact: { phone: `q${i}` } },
  }));
  const r = d.splitFollowUps([...awaitingRows, ...quietRows], NOW, { hotOnly: false });
  assert.deepEqual(r.awaiting.map((c) => c.id), ['a-pv', 'a-pv-stale', 'a-old', 'a-new']);
  assert.equal(r.quiet.length, d.LIST_CAP);
  assert.equal(r.quietTotal, 12);
  assert.equal(r.quiet[0].id, 'q11');
});

// ── Stalled ──────────────────────────────────────────────────────────

test('stalled: per-stage thresholds from the newest stage-history row', () => {
  const leads = [
    lead({ id: 'p8', stage: 'PROPOSED' }),
    lead({ id: 'p3', stage: 'PROPOSED' }),
    lead({ id: 'n4', stage: 'NEW' }),
    lead({ id: 'q9', stage: 'QUALIFYING' }),
    lead({ id: 'd7', stage: 'DIAGNOSED' }),
  ];
  const history = [
    { leadId: 'p8', toStage: 'PROPOSED', createdAt: daysAgo(8) },
    { leadId: 'p8', toStage: 'DIAGNOSED', createdAt: daysAgo(20) }, // older row, ignored
    { leadId: 'p3', toStage: 'PROPOSED', createdAt: daysAgo(3) },
    { leadId: 'n4', toStage: 'NEW', createdAt: daysAgo(4) },
    { leadId: 'q9', toStage: 'QUALIFYING', createdAt: daysAgo(9) },
    { leadId: 'd7', toStage: 'DIAGNOSED', createdAt: daysAgo(7) },
  ];
  const { items, total } = d.findStalled(leads, history, NOW, { hotOnly: false });
  assert.deepEqual(items.map((x) => `${x.lead.id}:${x.days}`).sort(), ['d7:7', 'n4:4', 'p8:8']);
  assert.equal(total, 3);
});

test('stalled: beyond the cold ceiling is not at-risk; won/lost never stall', () => {
  const leads = [
    lead({ id: 'cold', stage: 'PROPOSED' }),
    lead({ id: 'won', stage: 'CLOSED_WON' }),
    lead({ id: 'edge', stage: 'PROPOSED' }),
  ];
  const history = [
    { leadId: 'cold', toStage: 'PROPOSED', createdAt: daysAgo(d.STALL_MAX_DAYS + 1) },
    { leadId: 'won', toStage: 'CLOSED_WON', createdAt: daysAgo(40) },
    { leadId: 'edge', toStage: 'PROPOSED', createdAt: daysAgo(d.STALL_MAX_DAYS) },
  ];
  const { items } = d.findStalled(leads, history, NOW, { hotOnly: false });
  assert.deepEqual(items.map((x) => x.lead.id), ['edge']);
});

test('stalled: a lead whose thread has been dead longer than the cold ceiling is not at-risk, even if the stage is fresh', () => {
  const leads = [
    lead({ id: 'dead', stage: 'PROPOSED', conversations: [{ id: 'c', lastMessageAt: daysAgo(45), messages: [] }] }),
    lead({ id: 'noconv', stage: 'PROPOSED', conversations: [] }),
    lead({ id: 'alive', stage: 'PROPOSED', conversations: [{ id: 'c2', lastMessageAt: daysAgo(5), messages: [] }] }),
  ];
  const history = ['dead', 'noconv', 'alive'].map((leadId) => ({ leadId, toStage: 'PROPOSED', createdAt: daysAgo(10) }));
  assert.deepEqual(d.findStalled(leads, history, NOW, { hotOnly: false }).items.map((x) => x.lead.id), ['alive']);
});

test('stalled: no history row (or a row for another stage) falls back to updatedAt', () => {
  const leads = [
    lead({ id: 'nohist', stage: 'PROPOSED', updatedAt: daysAgo(10) }),
    lead({ id: 'mismatch', stage: 'PROPOSED', updatedAt: daysAgo(2) }),
  ];
  const history = [{ leadId: 'mismatch', toStage: 'DIAGNOSED', createdAt: daysAgo(15) }];
  const { items } = d.findStalled(leads, history, NOW, { hotOnly: false });
  assert.deepEqual(items.map((x) => x.lead.id), ['nohist']);
});

test('stalled: hottest first, then longest in stage', () => {
  const leads = [
    lead({ id: 'warm-long', stage: 'PROPOSED', aiScore: 40 }),
    lead({ id: 'hot-short', stage: 'PROPOSED', aiScore: 90 }),
  ];
  const history = [
    { leadId: 'warm-long', toStage: 'PROPOSED', createdAt: daysAgo(20) },
    { leadId: 'hot-short', toStage: 'PROPOSED', createdAt: daysAgo(8) },
  ];
  assert.deepEqual(d.findStalled(leads, history, NOW, { hotOnly: false }).items.map((x) => x.lead.id), ['hot-short', 'warm-long']);
});

test('quiet queue and stalled list report HOT leads only by default — a total that never moves gets ignored', () => {
  // Live DSP numbers before this filter: 239 quiet, 579 stalled. Both read
  // identically every morning, so the sections stopped carrying information.
  const rows = [
    conv({ id: 'hot', lastMessageAt: hoursAgo(60), messages: [{ direction: 'OUTBOUND' }], lead: { stage: 'PROPOSED', aiScore: 90, scoreLabel: 'HOT', contact: { phone: '1' } } }),
    conv({ id: 'warm', lastMessageAt: hoursAgo(60), messages: [{ direction: 'OUTBOUND' }], lead: { stage: 'PROPOSED', aiScore: 60, scoreLabel: 'WARM', contact: { phone: '2' } } }),
    conv({ id: 'cold', lastMessageAt: hoursAgo(60), messages: [{ direction: 'OUTBOUND' }], lead: { stage: 'PROPOSED', aiScore: 20, scoreLabel: 'COLD', contact: { phone: '3' } } }),
  ];
  const r = d.splitFollowUps(rows, NOW);
  assert.deepEqual(r.quiet.map((c) => c.id), ['hot']);
  assert.equal(r.quietTotal, 1);

  const leads = [
    lead({ id: 'hot', stage: 'PROPOSED', scoreLabel: 'HOT' }),
    lead({ id: 'warm', stage: 'PROPOSED', scoreLabel: 'WARM' }),
  ];
  const history = ['hot', 'warm'].map((leadId) => ({ leadId, toStage: 'PROPOSED', createdAt: daysAgo(9) }));
  const st = d.findStalled(leads, history, NOW);
  assert.deepEqual(st.items.map((x) => x.lead.id), ['hot']);
  assert.equal(st.total, 1);
});

test('the awaiting-reply queue is never score-filtered — a person waiting on a human always counts', () => {
  const rows = [
    conv({ id: 'cold-waiting', status: 'HUMAN_TAKEOVER', messages: [{ direction: 'INBOUND' }], lead: { stage: 'NEW', aiScore: 10, scoreLabel: 'COLD', contact: { phone: '9' } } }),
  ];
  assert.deepEqual(d.splitFollowUps(rows, NOW).awaiting.map((c) => c.id), ['cold-waiting']);
});

// ── Wins ─────────────────────────────────────────────────────────────

test('wins: paid only, summed in the tenant currency', () => {
  const won = [
    lead({ enrollmentFee: '28000' }),
    lead({ enrollmentFee: 28000 }),
    lead({ enrollmentFee: 0 }),
    lead({ enrollmentFee: null }),
  ];
  const w = d.summarizeWins(won, 'PKR');
  assert.equal(w.count, 2);
  assert.equal(w.total, 56000);
  assert.equal(w.currency, 'PKR');
});

// ── Actions + rendering ──────────────────────────────────────────────

test('actions: payment proof beats the call list, then the owed reply; max three', () => {
  const s = emptySections();
  s.callList = [lead({ id: 'hot', scoreLabel: 'HOT', aiScore: 92, nextAction: 'close_deal', contact: { name: 'Ayesha', phone: '923001111111' } })];
  s.followUps.awaiting = [
    conv({ status: 'HUMAN_TAKEOVER', lastMessageAt: hoursAgo(5), lead: { stage: 'QUALIFYING', aiScore: 50, contact: { name: 'Bilal', phone: '923002222222' } } }),
    conv({ status: 'PENDING_VERIFICATION', lastMessageAt: hoursAgo(1), lead: { stage: 'PROPOSED', aiScore: 80, contact: { name: 'Chand', phone: '923003333333' } } }),
  ];
  s.followUps.awaitingTotal = 2;
  s.needsEmail = [lead({ contact: { name: 'Dawood', phone: '923004444444' } })];
  const actions = d.rankActions(s);
  assert.equal(actions.length, 3);
  assert.match(actions[0], /Verify the payment proof from Chand/);
  assert.match(actions[1], /Call Ayesha/);
  assert.match(actions[2], /Reply to Bilal/);
});

test('actions: fall through to needs-email, stalled, and quiet when nothing hotter exists', () => {
  const s = emptySections();
  s.needsEmail = [lead({ contact: { name: 'Dawood', phone: '923004444444' } })];
  s.stalled = { items: [{ lead: lead({ stage: 'PROPOSED', contact: { name: 'Erum', phone: '923005555555' } }), days: 9, threshold: 7 }], total: 1 };
  s.followUps.quiet = [conv({ lastMessageAt: hoursAgo(72), lead: { stage: 'QUALIFYING', aiScore: 70, contact: { name: 'Faisal', phone: '923006666666' } } })];
  s.followUps.quietTotal = 1;
  const actions = d.rankActions(s);
  assert.match(actions[0], /email from Dawood/);
  assert.match(actions[1], /Nudge Erum .* 9 days in PROPOSED/);
  assert.match(actions[2], /Re-open Faisal/);
});

test('empty state: one short line, no zero-rows, no actions', () => {
  const s = emptySections();
  assert.equal(d.isEmptyDigest(s), true);
  const digest = d.buildDigest(s, { name: 'DSP' });
  assert.equal(digest.empty, true);
  assert.equal(digest.sections.length, 0);
  assert.equal(digest.actions.length, 0);
  assert.match(digest.subject, /Nothing needs you today/);
  const text = d.renderText(digest);
  assert.match(text, /Nothing needs you today/);
  assert.doesNotMatch(text, /\(0\)/);
  assert.doesNotMatch(text, /CALL LIST/);
});

test('a single win yesterday is not an empty digest', () => {
  const s = emptySections();
  s.wins = d.summarizeWins([lead({ enrollmentFee: 28000, contact: { name: 'Ghazal', phone: '923007777777' } })], 'PKR');
  assert.equal(d.isEmptyDigest(s), false);
  const text = d.renderText(d.buildDigest(s, { name: 'DSP' }));
  assert.match(text, /1 paid — PKR 28,000/);
  assert.match(text, /Ghazal — PKR 28,000/);
});

test('full render carries every section, the phone, the opener, and the actions', () => {
  const s = emptySections();
  const hot = lead({ id: 'hot', scoreLabel: 'HOT', aiScore: 92, nextAction: 'send_proposal', problemSummary: 'Wants to freelance on Upwork', contact: { name: 'Ayesha', phone: '923001111111' } });
  hot.conversations[0].messages = [{ content: 'fee kitni hai?', sentAt: hoursAgo(3) }];
  s.newLeads = [hot];
  s.callList = [hot];
  const digest = d.buildDigest(s, { name: 'DSP' });
  const text = d.renderText(digest);
  assert.match(text, /NEW LEADS SINCE YESTERDAY \(1\)/);
  assert.match(text, /TODAY'S CALL LIST \(1\)/);
  assert.match(text, /1\. Ayesha \+923001111111 — HOT 92\/100/);
  assert.match(text, /Problem: Wants to freelance on Upwork/);
  assert.match(text, /Last said: "fee kitni hai\?" \(3h ago\)/);
  assert.match(text, /Opener: Send the fee and payment details/);
  assert.match(text, /TODAY'S 3 HIGHEST-VALUE ACTIONS\n1\. Call Ayesha/);
  // Call-list line links to the conversation.
  const call = digest.sections.find((x) => x.title.startsWith("Today's call list"));
  assert.match(call.lines[0].url, /\/conversations\?id=conv-hot$/);
});

test('whatsapp params: seven strings, no newlines, top action truncated', () => {
  const s = emptySections();
  s.callList = [lead({ scoreLabel: 'HOT', aiScore: 92, nextAction: 'close_deal', problemSummary: 'x'.repeat(300), qualificationData: { lastUrgencyTrigger: 'y'.repeat(200) }, contact: { name: 'Ayesha', phone: '923001111111' } })];
  const p = d.waParams(d.buildDigest(s, { name: 'DSP' }));
  assert.equal(p.length, 7);
  for (const v of p) { assert.equal(typeof v, 'string'); assert.doesNotMatch(v, /[\n\t]/); }
  assert.ok(p[6].length <= 140);
  const wa = d.renderWhatsAppText(d.buildDigest(s, { name: 'DSP' }));
  assert.match(wa, /1 to call today/);
  assert.match(wa, /Full list is in your inbox/);
});

// ── Gating ───────────────────────────────────────────────────────────

test('gate: both daily channels off (or missing) → not eligible; whatsapp needs adminPhone', () => {
  assert.equal(d.isEligible({ settings: {} }), false);
  assert.equal(d.isEligible({ settings: { notifPrefs: { daily: { whatsapp: false, email: false } } } }), false);
  assert.equal(d.isEligible({ settings: { notifPrefs: { daily: { whatsapp: true } } } }), false);
  assert.equal(d.isEligible({ settings: { adminPhone: '923001234567', notifPrefs: { daily: { whatsapp: true } } } }), true);
  assert.equal(d.isEligible({ settings: { notifPrefs: { daily: { email: true } } } }), true);
  // Truthy-but-not-boolean values don't count — the toggle writes booleans.
  assert.equal(d.isEligible({ settings: { notifPrefs: { daily: { email: 'yes' } } } }), false);
});
