// src/services/needsYou.select.js
// THE definition of "who needs a human today" — shared by the Today's Queue
// page (modules/today) and the 09:00 daily digest (dailyDigest.service.js),
// so the screen and the inbox can never disagree about who is waiting.
//
// Pure: every function takes already-loaded rows and returns a decision.
// No Prisma, no Redis, no network — unit tested in test/needs-you-queue.test.js
// and test/daily-digest.test.js. needsYou.service.js does the IO.
//
// Groups (mutually exclusive, first match wins, in urgency order):
//   needs_me   — a human owes them something: a payment proof to verify
//                (PENDING_VERIFICATION), or the last message is theirs on a
//                thread the AI is no longer answering (handoff / AI off).
//                Never score-filtered — money and handoffs matter whatever
//                the score.
//   unanswered — the AI should have replied and didn't: last message is
//                theirs, AI on, older than UNANSWERED_MINUTES. Usually empty;
//                anything here is a failure (token budget hit, send error).
//   quiet      — WE spoke last and they've been silent QUIET_HOURS+. HOT and
//                WARM only: the cold tail is the automation sequences' job,
//                and an unfiltered count in the hundreds "never moves and
//                becomes wallpaper" (the digest learned that on day one).
//   stalled    — sitting in a stage past its threshold (lead_stage_history),
//                minus anyone already in a group above.
//
// Sorting inside a group is by VALUE, not by time. Every lead is worth the
// same fee, so value means probability of paying: how far down the funnel
// they are plus the AI score, then the longest wait breaks ties.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ── Tunables (the digest imports these — one source of truth) ────────
const QUIET_HOURS = 48;          // we spoke last and they've gone quiet this long
const UNANSWERED_MINUTES = 30;   // AI normally answers in under a minute
const LOOKBACK_DAYS = 14;        // follow-up scan horizon
// Days in the current stage before a lead counts as stalled. CLOSED_* never
// stall. Beyond STALL_MAX_DAYS a lead is cold, not at-risk — the 130-odd
// legacy PROPOSED leads would otherwise sit in this section forever.
const STALL_THRESHOLDS_DAYS = { NEW: 3, QUALIFYING: 10, DIAGNOSED: 7, PROPOSED: 7 };
const STALL_MAX_DAYS = 30;
const OPEN_STAGES = ['NEW', 'QUALIFYING', 'DIAGNOSED', 'PROPOSED'];
// Who the quiet / stalled groups admit on the page, and how many rows each
// shows. Learned from the first dry run on DSP's live data (2 Sep 2026):
// unfiltered, "gone quiet" was 110 rows and "stalled" 263 — the same
// wallpaper the digest hit on day one. So: quiet admits HOT leads at any
// open stage plus WARM leads who reached PROPOSED (the "almost paid" list);
// stalled admits HOT only, like the digest; both show their top rows by
// value and report the true total alongside. A human who is owed a reply
// (needs_me / unanswered) is never filtered or capped.
const QUEUE_TIERS = ['HOT', 'WARM'];   // legacy: score labels a tiers-based caller admits
const quietAdmit = (lead) => lead?.scoreLabel === 'HOT' || (lead?.scoreLabel === 'WARM' && lead?.stage === 'PROPOSED');
const stalledAdmit = (lead) => lead?.scoreLabel === 'HOT';
const QUEUE_CAPS = { quiet: 10, stalled: 10 };
// A human owes a reply for as long as it stays unanswered — the awaiting
// scan looks back further than the quiet scan (which is about recoverability).
const AWAITING_LOOKBACK_DAYS = STALL_MAX_DAYS;
// CLOSED_WON only ever reaches the page as an enrolled student who wrote to
// us — a paying customer's message outranks any prospect's.
const STAGE_BONUS = { CLOSED_WON: 50, PROPOSED: 40, DIAGNOSED: 20, QUALIFYING: 10, NEW: 0 };
const GROUP_ORDER = ['needs_me', 'unanswered', 'quiet', 'stalled'];

// ── Helpers ──────────────────────────────────────────────────────────
const daysBetween = (from, to) => Math.floor((to - new Date(from)) / DAY_MS);
const hoursBetween = (from, to) => Math.floor((to - new Date(from)) / HOUR_MS);

// One row per person. Duplicate lead rows for the same phone exist in real
// data (manual entries, re-imports); nobody should be listed twice.
const contactKey = (lead) => String(lead?.contact?.phone || lead?.id || '');
const dedupeByContact = (rows, keyOf = contactKey) => {
  const seen = new Set();
  return rows.filter((r) => {
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const lastActivityAt = (lead) => {
  const t = lead.conversations?.[0]?.lastMessageAt;
  return t ? new Date(t).getTime() : 0;
};

// Probability-of-paying rank. Higher is more valuable.
const valueRank = (lead, { paymentProof = false } = {}) => (paymentProof ? 1000 : 0)
  + (Number(lead?.aiScore) || 0)
  + (STAGE_BONUS[lead?.stage] || 0);

// AGENT sees their own leads plus unassigned ones; admins see the tenant.
const visibleTo = (lead, viewer) => {
  if (!viewer || viewer.role !== 'AGENT') return true;
  return !lead?.assignedTo || lead.assignedTo === viewer.userId;
};

// ── Follow-up split (digest + queue) ─────────────────────────────────
// `convs` are conversation rows with { id, status, aiEnabled, lastMessageAt,
// lead: { stage, aiScore, scoreLabel, ... }, messages: [latest] }.
//
// Returns { awaiting, quiet } as the digest has always consumed them, plus
// `unanswered` for the queue. tiers restricts the QUIET half; the awaiting
// half is never filtered.
const splitFollowUps = (convs, now = new Date(), {
  quietHours = QUIET_HOURS, lookbackDays = LOOKBACK_DAYS, awaitingLookbackDays = null, cap = Infinity,
  hotOnly = true, tiers = null, admit = null, unansweredMinutes = UNANSWERED_MINUTES,
} = {}) => {
  const admitTiers = tiers || (hotOnly ? ['HOT'] : null);
  const admitQuiet = admit || (admitTiers ? (lead) => admitTiers.includes(lead?.scoreLabel) : () => true);
  const lookback = now.getTime() - lookbackDays * DAY_MS;
  const awaitingLookback = now.getTime() - (awaitingLookbackDays || lookbackDays) * DAY_MS;
  const quietCutoff = now.getTime() - quietHours * HOUR_MS;
  const unansweredCutoff = now.getTime() - unansweredMinutes * 60 * 1000;
  const awaiting = [];
  const quiet = [];
  const unanswered = [];

  for (const c of convs) {
    const last = c.messages?.[0];
    const lastAt = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
    if (!lastAt || lastAt < Math.min(lookback, awaitingLookback)) continue;
    const stage = c.lead?.stage;
    if (stage === 'CLOSED_LOST') continue;

    const aiOff = c.status === 'HUMAN_TAKEOVER' || c.aiEnabled === false;
    const theirs = last?.direction === 'INBOUND';
    if (c.status === 'PENDING_VERIFICATION') {
      // A proof on an OPEN lead is money to verify whoever spoke last. On a
      // lead already marked won the verification happened elsewhere; the
      // parked thread only matters if the student is now waiting on us.
      if (stage !== 'CLOSED_WON' || theirs) awaiting.push(c);
      continue;
    }
    if (aiOff && theirs) {
      awaiting.push(c);
      continue;
    }
    if (lastAt < lookback) continue;
    if (stage === 'CLOSED_WON' || c.status === 'CLOSED') continue;
    if (!aiOff && theirs) {
      if (lastAt <= unansweredCutoff) unanswered.push(c);
      continue;
    }
    if (!admitQuiet(c.lead)) continue;
    if (last?.direction === 'OUTBOUND' && lastAt <= quietCutoff) quiet.push(c);
  }

  // Money first — freshest payment proof on top (that's live money; a
  // week-old one is probably already handled elsewhere) — then everyone
  // else, longest wait first.
  const isPv = (c) => c.status === 'PENDING_VERIFICATION';
  awaiting.sort((a, b) => {
    if (isPv(a) !== isPv(b)) return isPv(a) ? -1 : 1;
    return isPv(a)
      ? new Date(b.lastMessageAt) - new Date(a.lastMessageAt)
      : new Date(a.lastMessageAt) - new Date(b.lastMessageAt);
  });
  // Hottest first, then longest silence.
  const byValue = (a, b) => valueRank(b.lead) - valueRank(a.lead)
    || new Date(a.lastMessageAt) - new Date(b.lastMessageAt);
  quiet.sort(byValue);
  unanswered.sort(byValue);

  const key = (c) => contactKey(c.lead) || c.id;
  const awaitingU = dedupeByContact(awaiting, key);
  const quietU = dedupeByContact(quiet, key);
  const unansweredU = dedupeByContact(unanswered, key);
  return {
    awaiting: awaitingU.slice(0, cap), awaitingTotal: awaitingU.length,
    quiet: quietU.slice(0, cap), quietTotal: quietU.length,
    unanswered: unansweredU.slice(0, cap), unansweredTotal: unansweredU.length,
  };
};

// ── Stalled (digest + queue) ─────────────────────────────────────────
// Stalled = sitting in the current stage ≥ threshold days (and ≤ maxDays,
// past which it's cold rather than at-risk). Stage entry time comes from the
// newest lead_stage_history row for that lead; leads that predate the history
// table fall back to updatedAt. A lead also has to have actually talked to
// us within maxDays — a lead whose thread has been dead for a month isn't
// "at risk", it's gone, and DSP has 600+ of those in PROPOSED.
const findStalled = (leads, historyRows, now = new Date(), {
  thresholds = STALL_THRESHOLDS_DAYS, maxDays = STALL_MAX_DAYS, cap = Infinity, hotOnly = true, tiers = null, admit = null,
} = {}) => {
  const admitTiers = tiers || (hotOnly ? ['HOT'] : null);
  const admitLead = admit || (admitTiers ? (lead) => admitTiers.includes(lead?.scoreLabel) : () => true);
  const enteredAt = new Map();
  for (const h of historyRows) {
    // historyRows are newest-first; first hit per lead wins.
    if (!enteredAt.has(h.leadId)) enteredAt.set(h.leadId, h);
  }
  const activeSince = now.getTime() - maxDays * DAY_MS;
  const out = [];
  for (const lead of leads) {
    const threshold = thresholds[lead.stage];
    if (!threshold) continue;
    if (!admitLead(lead)) continue;
    if (lastActivityAt(lead) < activeSince) continue;
    const h = enteredAt.get(lead.id);
    // A history row for a different stage than the lead is in means the
    // latest transition wasn't recorded — fall back to updatedAt.
    const since = h && h.toStage === lead.stage ? h.createdAt : lead.updatedAt;
    const days = daysBetween(since, now);
    if (days >= threshold && days <= maxDays) out.push({ lead, days, threshold, since });
  }
  out.sort((a, b) => valueRank(b.lead) - valueRank(a.lead) || b.days - a.days);
  const unique = dedupeByContact(out, (x) => contactKey(x.lead));
  return { items: unique.slice(0, cap), total: unique.length };
};

// ── The queue ────────────────────────────────────────────────────────
// Turns the raw rows into the page's row list. `sequences` maps leadId →
// { ruleName, step, total, nextDueAt } for leads mid-automation; `snoozed`
// is the set of conversation ids the viewer hid until tomorrow.
const oneLine = (s, max = 140) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const rowFromConversation = (c, group, reason, now) => {
  const lead = c.lead || {};
  const last = c.messages?.[0] || null;
  const lastInboundAt = c.lastInboundAt || (last?.direction === 'INBOUND' ? last.sentAt : null);
  const waitingSince = c.lastMessageAt;
  return {
    group,
    reason,
    conversationId: c.id,
    leadId: lead.id || null,
    name: (lead.contact?.name || '').trim() || 'Unknown',
    phone: lead.contact?.phone || null,
    stage: lead.stage || null,
    scoreLabel: lead.scoreLabel || 'COLD',
    aiScore: Number(lead.aiScore) || 0,
    rank: valueRank(lead, { paymentProof: reason === 'payment_proof' }),
    waitingSince,
    hoursWaiting: waitingSince ? hoursBetween(waitingSince, now) : null,
    // The one-liner is what you'd be replying to — their own last words —
    // with the Qualifier's problem summary as context. A stale summary
    // ("wants to reserve a seat") under a fresh "refund chahiye" misleads.
    summary: oneLine(c.lastInboundText || (last?.direction === 'INBOUND' ? last.content : '') || lead.problemSummary || ''),
    problem: oneLine(lead.problemSummary || ''),
    lastMessage: last ? { id: last.id || null, direction: last.direction, sender: last.sender, content: oneLine(last.content, 200), sentAt: last.sentAt } : null,
    lastInboundAt,
    insideWindow: !!lastInboundAt && (now - new Date(lastInboundAt)) < DAY_MS,
    aiEnabled: c.aiEnabled !== false,
    status: c.status,
  };
};

const rowFromStalled = ({ lead, days, threshold, since }, now) => {
  const c = lead.conversations?.[0] || {};
  const last = c.messages?.[0] || null;
  const lastInboundAt = c.lastInboundAt || (last?.direction === 'INBOUND' ? last.sentAt : null);
  return {
    group: 'stalled',
    reason: `${days}d in ${String(lead.stage || '').replace('_', ' ')} (limit ${threshold}d)`,
    conversationId: c.id || null,
    leadId: lead.id,
    name: (lead.contact?.name || '').trim() || 'Unknown',
    phone: lead.contact?.phone || null,
    stage: lead.stage,
    scoreLabel: lead.scoreLabel || 'COLD',
    aiScore: Number(lead.aiScore) || 0,
    rank: valueRank(lead),
    waitingSince: since,
    hoursWaiting: since ? hoursBetween(since, now) : null,
    daysInStage: days,
    summary: oneLine(c.lastInboundText || (last?.direction === 'INBOUND' ? last.content : '') || lead.problemSummary || ''),
    problem: oneLine(lead.problemSummary || ''),
    lastMessage: last ? { id: last.id || null, direction: last.direction, sender: last.sender, content: oneLine(last.content, 200), sentAt: last.sentAt } : null,
    lastInboundAt,
    insideWindow: !!lastInboundAt && (now - new Date(lastInboundAt)) < DAY_MS,
    aiEnabled: c.aiEnabled !== false,
    status: c.status || null,
  };
};

const awaitingReason = (c) => {
  const won = c.lead?.stage === 'CLOSED_WON';
  if (c.status === 'PENDING_VERIFICATION' && !won) return 'payment_proof';
  if (won) return 'student_message';
  return c.status === 'HUMAN_TAKEOVER' ? 'handoff' : 'ai_off';
};

// `snoozed` = conversation ids hidden for today; `dismissed` = Map of
// conversation id → the latest message id at dismissal time: hidden until
// the thread moves (a new message makes the pair stale and the row returns).
const buildQueue = ({ convs = [], openLeads = [], historyRows = [], sequences = {}, snoozed = new Set(), dismissed = new Map() }, now = new Date(), {
  viewer = null, quietHours = QUIET_HOURS, unansweredMinutes = UNANSWERED_MINUTES,
  admitQuiet = quietAdmit, admitStalled = stalledAdmit, caps = QUEUE_CAPS,
} = {}) => {
  const visibleConvs = convs.filter((c) => visibleTo(c.lead, viewer));
  const visibleLeads = openLeads.filter((l) => visibleTo(l, viewer));

  const fu = splitFollowUps(visibleConvs, now, { quietHours, admit: admitQuiet, unansweredMinutes, awaitingLookbackDays: AWAITING_LOOKBACK_DAYS });
  const rows = [];
  for (const c of fu.awaiting) rows.push(rowFromConversation(c, 'needs_me', awaitingReason(c), now));
  for (const c of fu.unanswered) rows.push(rowFromConversation(c, 'unanswered', 'no_reply_from_ai', now));
  for (const c of fu.quiet) rows.push(rowFromConversation(c, 'quiet', 'we_spoke_last', now));

  const taken = new Set(rows.map((r) => r.leadId).filter(Boolean));
  const takenPhones = new Set(rows.map((r) => r.phone).filter(Boolean));
  const stalled = findStalled(visibleLeads.filter((l) => !taken.has(l.id) && !takenPhones.has(l.contact?.phone)), historyRows, now, { admit: admitStalled });
  for (const s of stalled.items) rows.push(rowFromStalled(s, now));

  // Decorate + snooze filter.
  let hidden = 0;
  const kept = [];
  for (const r of rows) {
    r.sequence = (r.leadId && sequences[r.leadId]) || null;
    if (r.conversationId && snoozed.has(r.conversationId)) { hidden += 1; continue; }
    if (r.conversationId && dismissed.get(r.conversationId) && dismissed.get(r.conversationId) === (r.lastMessage?.id || 'none')) { hidden += 1; continue; }
    kept.push(r);
  }

  // Order inside a group:
  //   needs_me / unanswered — in-window first (a free-text reply is possible
  //   right now and the window is closing), then value, then longest wait.
  //   quiet / stalled — value, then SHORTEST wait: a lead silent for two days
  //   is recoverable, one silent for two weeks mostly isn't.
  const order = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  const owed = (g) => g === 'needs_me' || g === 'unanswered';
  kept.sort((a, b) => order.get(a.group) - order.get(b.group)
    || (owed(a.group) ? (b.insideWindow ? 1 : 0) - (a.insideWindow ? 1 : 0) : 0)
    || b.rank - a.rank
    || (owed(a.group) ? (b.hoursWaiting || 0) - (a.hoursWaiting || 0) : (a.hoursWaiting || 0) - (b.hoursWaiting || 0)));

  // Caps: show the top N by value per capped group, report the true total.
  const totals = Object.fromEntries(GROUP_ORDER.map((g) => [g, kept.filter((r) => r.group === g).length]));
  const seen = {};
  const out = kept.filter((r) => {
    const cap = caps[r.group];
    seen[r.group] = (seen[r.group] || 0) + 1;
    return !cap || seen[r.group] <= cap;
  });
  const counts = Object.fromEntries(GROUP_ORDER.map((g) => [g, out.filter((r) => r.group === g).length]));
  return { rows: out, counts, totals, total: out.length, hidden, groups: GROUP_ORDER };
};

module.exports = {
  HOUR_MS, DAY_MS,
  QUIET_HOURS, UNANSWERED_MINUTES, LOOKBACK_DAYS, AWAITING_LOOKBACK_DAYS, STALL_THRESHOLDS_DAYS, STALL_MAX_DAYS, OPEN_STAGES,
  QUEUE_TIERS, QUEUE_CAPS, STAGE_BONUS, GROUP_ORDER, quietAdmit, stalledAdmit, awaitingReason,
  contactKey, dedupeByContact, lastActivityAt, valueRank, visibleTo, daysBetween, hoursBetween, oneLine,
  splitFollowUps, findStalled, buildQueue,
};
