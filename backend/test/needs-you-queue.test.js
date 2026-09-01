// test/needs-you-queue.test.js
//
// Today's Queue selection (services/needsYou.select.js) — the one definition
// of "who needs a human today" that the /today page and the daily digest
// both run. Pure: no DB, no Redis, no network.
//
// Pinned here:
//   - the four groups and their precedence (needs_me > unanswered > quiet > stalled)
//   - a payment proof always tops the page, whatever the score
//   - unanswered = AI on, their message, older than the grace period
//   - quiet = we spoke last, 48h+, HOT/WARM only (cold is the sequences' job)
//   - won / lost / closed threads never appear (except a proof to verify)
//   - sorting is by value (stage + score), not by wait time
//   - AGENT visibility: own + unassigned leads only
//   - snoozed rows are hidden and counted
//   - a lead mid-sequence carries its badge
//   - the 24h window flag
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const q = require('../src/services/needsYou.select');

const NOW = new Date('2026-09-02T04:00:00Z'); // 09:00 PKT
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000);
const daysAgo = (n) => hoursAgo(n * 24);

let seq = 0;
const phone = () => `92300${String(++seq).padStart(7, '0')}`;

const conv = ({ id, status = 'AI_HANDLING', aiEnabled = true, lastAt, direction = 'OUTBOUND', sender, stage = 'QUALIFYING', score = 60, label = 'WARM', assignedTo = null, name, content = 'hello', lastInboundAt } = {}) => ({
  id: id || `c${++seq}`,
  status,
  aiEnabled,
  lastMessageAt: lastAt,
  lastInboundAt: lastInboundAt || (direction === 'INBOUND' ? lastAt : undefined),
  lead: { id: `l-${id || seq}`, stage, aiScore: score, scoreLabel: label, assignedTo, problemSummary: '', contact: { name: name || `Lead ${seq}`, phone: phone() } },
  messages: [{ id: `m${seq}`, direction, sender: sender || (direction === 'INBOUND' ? 'CONTACT' : 'AI'), sentAt: lastAt, content }],
});

const build = (convs, extra = {}, opts = {}) => q.buildQueue({ convs, ...extra }, NOW, opts);

test('a payment proof waiting for verification tops the whole page, whatever the score', () => {
  const pv = conv({ id: 'pv', status: 'PENDING_VERIFICATION', lastAt: hoursAgo(2), direction: 'INBOUND', score: 5, label: 'COLD', stage: 'PROPOSED' });
  const hot = conv({ id: 'hot', status: 'HUMAN_TAKEOVER', aiEnabled: false, lastAt: hoursAgo(30), direction: 'INBOUND', score: 100, label: 'HOT', stage: 'PROPOSED' });
  const { rows, counts } = build([hot, pv]);
  assert.equal(rows[0].conversationId, 'pv');
  assert.equal(rows[0].group, 'needs_me');
  assert.equal(rows[0].reason, 'payment_proof');
  assert.equal(rows[1].conversationId, 'hot');
  assert.equal(rows[1].reason, 'handoff');
  assert.equal(counts.needs_me, 2);
});

test('their message on an AI-off thread needs me; ours on an AI-off thread is just quiet', () => {
  const theirs = conv({ id: 'theirs', aiEnabled: false, lastAt: hoursAgo(1), direction: 'INBOUND', label: 'HOT' });
  const ours = conv({ id: 'ours', aiEnabled: false, lastAt: hoursAgo(60), direction: 'OUTBOUND', sender: 'AGENT', label: 'HOT' });
  const { rows } = build([theirs, ours]);
  assert.deepEqual(rows.map((r) => [r.conversationId, r.group]), [['theirs', 'needs_me'], ['ours', 'quiet']]);
  assert.equal(rows[0].reason, 'ai_off');
});

test('unanswered = AI on, last message theirs, older than the grace period', () => {
  const stale = conv({ id: 'stale', lastAt: hoursAgo(2), direction: 'INBOUND', label: 'COLD', score: 10 });
  const fresh = conv({ id: 'fresh', lastAt: new Date(NOW.getTime() - 5 * 60 * 1000), direction: 'INBOUND', label: 'HOT' });
  const { rows, counts } = build([stale, fresh]);
  assert.equal(counts.unanswered, 1);
  assert.equal(rows[0].conversationId, 'stale');
  assert.equal(rows[0].reason, 'no_reply_from_ai');
  // Never score-filtered: an unanswered COLD lead is still an AI failure.
  assert.equal(rows[0].scoreLabel, 'COLD');
});

test('quiet = we spoke last, 48h+: HOT at any stage, WARM only once PROPOSED', () => {
  const hotQuiet = conv({ id: 'hq', lastAt: hoursAgo(50), label: 'HOT', score: 90 });
  const warmProposed = conv({ id: 'wp', lastAt: hoursAgo(72), label: 'WARM', score: 60, stage: 'PROPOSED' });
  const warmQualifying = conv({ id: 'wq', lastAt: hoursAgo(72), label: 'WARM', score: 60, stage: 'QUALIFYING' });
  const coldQuiet = conv({ id: 'cq', lastAt: hoursAgo(72), label: 'COLD', score: 10 });
  const notYet = conv({ id: 'ny', lastAt: hoursAgo(47), label: 'HOT', score: 99 });
  const { rows, counts } = build([coldQuiet, notYet, warmQualifying, warmProposed, hotQuiet]);
  assert.equal(counts.quiet, 2);
  assert.deepEqual(rows.map((r) => r.conversationId), ['hq', 'wp']);
  assert.equal(rows[0].reason, 'we_spoke_last');
});

test('quiet and stalled show their top rows by value and report the true total', () => {
  const many = Array.from({ length: 14 }, (_, i) => conv({ id: `q${i}`, lastAt: hoursAgo(50 + i), label: 'HOT', score: 100 - i }));
  const { rows, counts, totals } = build(many);
  assert.equal(counts.quiet, 10);
  assert.equal(totals.quiet, 14);
  assert.equal(rows[0].conversationId, 'q0');
  assert.equal(rows.length, 10);
});

test('an enrolled student who wrote to us is "needs me" and outranks any prospect', () => {
  const student = conv({ id: 'st', stage: 'CLOSED_WON', status: 'CLOSED', aiEnabled: false, lastAt: hoursAgo(5), direction: 'INBOUND', score: 90, label: 'HOT', content: 'sign-in link kab milega?' });
  const proposed = conv({ id: 'pr', stage: 'PROPOSED', status: 'HUMAN_TAKEOVER', aiEnabled: false, lastAt: hoursAgo(5), direction: 'INBOUND', score: 90, label: 'HOT' });
  const { rows } = build([proposed, student]);
  assert.deepEqual(rows.map((r) => [r.conversationId, r.reason]), [['st', 'student_message'], ['pr', 'handoff']]);
});

test('a parked payment-proof thread on an already-won lead is listed only if the student wrote last', () => {
  const stale = conv({ id: 'stale', stage: 'CLOSED_WON', status: 'PENDING_VERIFICATION', aiEnabled: false, lastAt: hoursAgo(200), direction: 'OUTBOUND', sender: 'AGENT' });
  const owed = conv({ id: 'owed', stage: 'CLOSED_WON', status: 'PENDING_VERIFICATION', aiEnabled: false, lastAt: hoursAgo(4), direction: 'INBOUND', content: 'refund chahiye' });
  const open = conv({ id: 'open', stage: 'PROPOSED', status: 'PENDING_VERIFICATION', aiEnabled: false, lastAt: hoursAgo(200), direction: 'OUTBOUND', sender: 'AI' });
  const { rows } = build([stale, owed, open]);
  assert.deepEqual(rows.map((r) => [r.conversationId, r.reason]).sort(), [['open', 'payment_proof'], ['owed', 'student_message']]);
});

test('a reply owed for three weeks is still owed; a quiet lead that old is not "quiet"', () => {
  const oldHandoff = conv({ id: 'oh', status: 'HUMAN_TAKEOVER', aiEnabled: false, lastAt: daysAgo(24), direction: 'INBOUND', label: 'HOT' });
  const oldQuiet = conv({ id: 'oq', lastAt: daysAgo(24), label: 'HOT' });
  const { rows } = build([oldHandoff, oldQuiet]);
  assert.deepEqual(rows.map((r) => [r.conversationId, r.group]), [['oh', 'needs_me']]);
});

test('in the owed groups, in-window rows come first; in quiet, the shortest silence wins a tie', () => {
  const late = conv({ id: 'late', status: 'HUMAN_TAKEOVER', aiEnabled: false, lastAt: hoursAgo(300), direction: 'INBOUND', label: 'HOT', score: 90, stage: 'PROPOSED' });
  const fresh = conv({ id: 'fresh', status: 'HUMAN_TAKEOVER', aiEnabled: false, lastAt: hoursAgo(10), direction: 'INBOUND', label: 'HOT', score: 90, stage: 'PROPOSED' });
  const q1 = conv({ id: 'q1', lastAt: hoursAgo(300), label: 'HOT', score: 90 });
  const q2 = conv({ id: 'q2', lastAt: hoursAgo(50), label: 'HOT', score: 90 });
  const { rows } = build([late, fresh, q1, q2]);
  assert.deepEqual(rows.map((r) => r.conversationId), ['fresh', 'late', 'q2', 'q1']);
});

test('won, lost and closed threads never appear — except a proof to verify', () => {
  const won = conv({ id: 'won', stage: 'CLOSED_WON', lastAt: hoursAgo(72), label: 'HOT' });
  const lost = conv({ id: 'lost', stage: 'CLOSED_LOST', lastAt: hoursAgo(1), direction: 'INBOUND', aiEnabled: false });
  const closed = conv({ id: 'closed', status: 'CLOSED', aiEnabled: false, lastAt: hoursAgo(72), label: 'HOT' });
  const wonProof = conv({ id: 'wonpv', stage: 'CLOSED_WON', status: 'PENDING_VERIFICATION', lastAt: hoursAgo(1), direction: 'INBOUND' });
  const old = conv({ id: 'old', lastAt: daysAgo(20), label: 'HOT' }); // beyond the 14-day lookback
  const { rows } = build([won, lost, closed, wonProof, old]);
  assert.deepEqual(rows.map((r) => r.conversationId), ['wonpv']);
});

test('inside a group, value beats waiting time: PROPOSED@60 waiting 3h outranks NEW@80 waiting 2d', () => {
  const proposed = conv({ id: 'p', stage: 'PROPOSED', score: 60, label: 'WARM', lastAt: hoursAgo(50) });
  const brandNew = conv({ id: 'n', stage: 'NEW', score: 80, label: 'HOT', lastAt: hoursAgo(96) });
  const { rows } = build([brandNew, proposed]);
  assert.deepEqual(rows.map((r) => r.conversationId), ['p', 'n']);
  assert.equal(rows[0].rank, 100); // 60 + PROPOSED bonus 40
  assert.equal(rows[1].rank, 80);
});

test('stalled leads come from stage history, exclude anyone already listed, and admit HOT/WARM', () => {
  const stalledLead = (id, { stage = 'PROPOSED', label = 'HOT', score = 80, phoneNo } = {}) => ({
    id, stage, aiScore: score, scoreLabel: label, updatedAt: daysAgo(20), assignedTo: null, problemSummary: 'Wants to earn from AI',
    contact: { name: id, phone: phoneNo || phone() },
    conversations: [{ id: `c-${id}`, status: 'AI_HANDLING', aiEnabled: true, lastMessageAt: daysAgo(2), messages: [{ direction: 'INBOUND', sender: 'CONTACT', sentAt: daysAgo(2), content: 'ok' }] }],
  });
  const stalled = stalledLead('s1');
  const cold = stalledLead('s2', { label: 'COLD' });
  const fine = stalledLead('s3'); // entered PROPOSED yesterday
  const alreadyQuiet = stalledLead('s4');
  const quietConv = conv({ id: 'q', lastAt: hoursAgo(72), label: 'HOT' });
  quietConv.lead.id = 's4';
  const historyRows = [
    { leadId: 's1', toStage: 'PROPOSED', createdAt: daysAgo(9) },
    { leadId: 's2', toStage: 'PROPOSED', createdAt: daysAgo(9) },
    { leadId: 's3', toStage: 'PROPOSED', createdAt: daysAgo(1) },
    { leadId: 's4', toStage: 'PROPOSED', createdAt: daysAgo(9) },
  ];
  const { rows, counts } = build([quietConv], { openLeads: [stalled, cold, fine, alreadyQuiet], historyRows });
  assert.equal(counts.stalled, 1);
  const s = rows.find((r) => r.group === 'stalled');
  assert.equal(s.leadId, 's1');
  assert.equal(s.daysInStage, 9);
  assert.match(s.reason, /9d in PROPOSED/);
  assert.equal(s.summary, 'ok');
  assert.equal(s.problem, 'Wants to earn from AI');
  // the quiet row (s4) is listed once, as quiet — not again as stalled
  assert.equal(rows.filter((r) => r.leadId === 's4').length, 1);
});

test('an AGENT sees only their own and unassigned leads; an admin sees everything', () => {
  const mine = conv({ id: 'mine', lastAt: hoursAgo(72), label: 'HOT', assignedTo: 'u-me' });
  const theirs = conv({ id: 'theirs', lastAt: hoursAgo(72), label: 'HOT', assignedTo: 'u-other' });
  const nobody = conv({ id: 'nobody', lastAt: hoursAgo(72), label: 'HOT' });
  const all = [mine, theirs, nobody];
  const agent = build(all, {}, { viewer: { userId: 'u-me', role: 'AGENT' } });
  assert.deepEqual(agent.rows.map((r) => r.conversationId).sort(), ['mine', 'nobody']);
  const admin = build(all, {}, { viewer: { userId: 'u-admin', role: 'TENANT_ADMIN' } });
  assert.equal(admin.rows.length, 3);
});

test('skipped rows are hidden and counted; a lead mid-sequence carries its badge', () => {
  const a = conv({ id: 'a', lastAt: hoursAgo(72), label: 'HOT' });
  const b = conv({ id: 'b', lastAt: hoursAgo(72), label: 'HOT' });
  const sequences = { [b.lead.id]: { ruleName: 'No-Reply Follow-up', step: 1, total: 3, nextDueAt: daysAgo(-2) } };
  const { rows, hidden, total } = build([a, b], { sequences, snoozed: new Set(['a']) });
  assert.equal(hidden, 1);
  assert.equal(total, 1);
  assert.equal(rows[0].conversationId, 'b');
  assert.equal(rows[0].sequence.step, 1);
  assert.equal(rows[0].sequence.total, 3);
});

test('a dismissed row stays hidden until the lead writes again', () => {
  const a = conv({ id: 'a', status: 'HUMAN_TAKEOVER', aiEnabled: false, lastAt: hoursAgo(72), direction: 'INBOUND', label: 'HOT' });
  const msgId = a.messages[0].id;
  const hiddenRun = build([a], { dismissed: new Map([['a', msgId]]) });
  assert.equal(hiddenRun.total, 0);
  assert.equal(hiddenRun.hidden, 1);
  // they wrote again → newer message id → the row is back
  a.messages = [{ id: 'newer', direction: 'INBOUND', sender: 'CONTACT', sentAt: hoursAgo(1), content: 'hello?' }];
  a.lastMessageAt = hoursAgo(1);
  const backRun = build([a], { dismissed: new Map([['a', msgId]]) });
  assert.equal(backRun.total, 1);
  assert.equal(backRun.rows[0].lastMessage.id, 'newer');
});

test('the 24h window flag follows the last INBOUND message, not the last message', () => {
  const inWindow = conv({ id: 'in', lastAt: hoursAgo(50), label: 'HOT', lastInboundAt: hoursAgo(20) });
  const outWindow = conv({ id: 'out', lastAt: hoursAgo(50), label: 'HOT', lastInboundAt: hoursAgo(30) });
  const never = conv({ id: 'never', lastAt: hoursAgo(50), label: 'HOT' });
  const { rows } = build([inWindow, outWindow, never]);
  const byId = Object.fromEntries(rows.map((r) => [r.conversationId, r.insideWindow]));
  assert.deepEqual(byId, { in: true, out: false, never: false });
});

test('one row per phone number even when a person has two lead rows', () => {
  const shared = phone();
  const a = conv({ id: 'a', lastAt: hoursAgo(72), label: 'HOT' }); a.lead.contact.phone = shared;
  const b = conv({ id: 'b', lastAt: hoursAgo(96), label: 'HOT' }); b.lead.contact.phone = shared;
  const { rows } = build([a, b]);
  assert.equal(rows.length, 1);
});

test('empty input is an empty queue, not an error', () => {
  const out = build([]);
  assert.equal(out.total, 0);
  assert.deepEqual(out.counts, { needs_me: 0, unanswered: 0, quiet: 0, stalled: 0 });
});
