// src/services/dailyDigest.service.js
// The 09:00 Asia/Karachi daily digest — "who do I contact today" in one
// briefing, per tenant, so the owner never has to open the dashboard to
// start the day. Scheduled by the scheduler worker ('daily-digest' job, see
// queues/message.queue.js registerDailyDigest).
//
// READS AND REPORTS ONLY. Nothing in this file messages a lead or a student;
// the only sends are to the tenant's own admin (email, and a short WhatsApp
// pointer when the tenant asked for one).
//
// Structure mirrors digest.service.js (the Monday weekly digest):
//   runDailyDigestForAllTenants  → runWithSystemScope, pick eligible tenants
//   sendDailyDigest(tenantId)    → requestContext.run({ tenantId }) so every
//                                   Prisma read runs under that tenant's RLS
//                                   context. Without this a background job
//                                   silently reads ZERO rows (the Sheets tick
//                                   taught us that the hard way).
//
// Everything that decides *what* lands in the digest — call-list selection,
// stall detection, the follow-up split, action ranking, empty-state — is a
// pure function exported for unit tests (test/daily-digest.test.js).
//
// Tenant settings used (tenant.settings JSON):
//   notifPrefs.daily   — { email: bool, whatsapp: bool }. Both off → skipped.
//   alertEmail         — preferred email recipient; falls back to digestEmail,
//                        then every active TENANT_ADMIN on the account.
//   adminPhone         — WhatsApp recipient (digits only).
//   dailyDigest.waTemplate — optional { name, language } of an approved Meta
//                        template; without it the WhatsApp copy is a free-form
//                        text that only delivers inside the 24h window.
//   defaultCurrency    — for the wins total (utils/currency.js).

const prisma = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const env = require('../config/env');
const { requestContext, runWithSystemScope } = require('../middleware/requestContext.middleware');
const { tenantCurrency } = require('../utils/currency');
const whatsappService = require('./whatsapp.service');
const emailService = require('./email.service');

// ── Tunables ─────────────────────────────────────────────────────────
const TZ = 'Asia/Karachi';
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // PKT is UTC+5, no DST
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const CALL_LIST_SIZE = 5;       // top hot leads to call today
const CALL_LIST_ACTIVE_DAYS = 7; // "hot right now": spoke to us this recently
const LIST_CAP = 10;            // max rows shown per list section
const NEW_LEADS_WINDOW_MS = DAY_MS; // "since the last digest"
const QUIET_HOURS = 48;         // we spoke last and they've gone quiet this long
const LOOKBACK_DAYS = 14;       // follow-up scan horizon
// Days in the current stage before a lead counts as stalled. CLOSED_* never
// stall. Beyond STALL_MAX_DAYS a lead is cold, not at-risk — the 130-odd
// legacy PROPOSED leads would otherwise sit in this section forever.
const STALL_THRESHOLDS_DAYS = { NEW: 3, QUALIFYING: 10, DIAGNOSED: 7, PROPOSED: 7 };
const STALL_MAX_DAYS = 30;
const OPEN_STAGES = ['NEW', 'QUALIFYING', 'DIAGNOSED', 'PROPOSED'];
const LOCK_TTL_SECONDS = 48 * 60 * 60;

// ── Time helpers (pure) ──────────────────────────────────────────────

// 'YYYY-MM-DD' of `now` in Asia/Karachi.
const pktDayKey = (now = new Date()) => new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);

// UTC instants for PKT midnight today and yesterday.
const pktDayBounds = (now = new Date()) => {
  const shifted = new Date(now.getTime() + PKT_OFFSET_MS);
  const todayStart = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - PKT_OFFSET_MS);
  return { todayStart, yesterdayStart: new Date(todayStart.getTime() - DAY_MS) };
};

const pktDayLabel = (now = new Date()) => new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(now);

const daysBetween = (from, to) => Math.floor((to - new Date(from)) / DAY_MS);
const hoursBetween = (from, to) => Math.floor((to - new Date(from)) / HOUR_MS);

const ago = (from, now) => {
  const h = hoursBetween(from, now);
  if (h < 1) return 'just now';
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// ── Formatting helpers (pure) ────────────────────────────────────────

const displayName = (lead) => (lead.contact?.name || '').trim() || 'Unknown';
const displayPhone = (lead) => (lead.contact?.phone ? `+${String(lead.contact.phone).replace(/^\+/, '')}` : 'no phone');
const oneLine = (s, max = 110) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const money = (amount, currency) => `${currency} ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
const tierLabel = (lead) => `${lead.scoreLabel || 'COLD'} ${lead.aiScore ?? 0}/100`;
const stageLabel = (stage) => String(stage || '').replace('_', ' ');

const conversationUrl = (conversationId) => (conversationId ? `${env.APP_URL}/conversations?id=${conversationId}` : null);

// The customer's own last words, if the lead carries them (getHotLeads-style
// include: conversations[0].messages[0] is the latest INBOUND message).
const lastInboundText = (lead) => lead.conversations?.[0]?.messages?.[0]?.content || '';

// One-line "what's their problem" — the Qualifier's problemSummary when it
// exists, otherwise the lead's own last message. No AI call.
const problemLine = (lead) => oneLine(lead.problemSummary || lastInboundText(lead) || 'No summary yet — read the thread');

// Suggested opener, derived from data already on the lead (Qualifier's
// next_action + the Closer's last urgency trigger). Deliberately NOT an AI
// call: five of these per tenant per day would be real Closer spend for
// text the owner will rephrase anyway.
const buildOpener = (lead) => {
  const q = lead.qualificationData && typeof lead.qualificationData === 'object' ? lead.qualificationData : {};
  const urgency = oneLine(q.lastUrgencyTrigger || '', 80);
  const withUrgency = (base) => (urgency ? `${base} Mention: ${urgency}` : base);

  switch (lead.nextAction) {
    case 'close_deal':
      return withUrgency('They\'re ready — ask if they want to lock their seat today and resend the payment details.');
    case 'send_proposal':
      return withUrgency('Send the fee and payment details, then ask which start date suits them.');
    case 'nurture':
      return 'No pitch — share one concrete result from a student in the same spot, then ask what changed for them.';
    case 'continue_qualifying':
    default:
      return lastInboundText(lead)
        ? 'Answer what they last asked first, then ask what outcome they want in the next 30 days.'
        : 'Ask what they want to achieve in the next 30 days, then qualify from there.';
  }
};

// ── Selection logic (pure) ───────────────────────────────────────────

// One row per person. Duplicate lead rows for the same phone exist in real
// data (manual entries, re-imports); the digest shouldn't list them twice.
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

// Today's call list: open HOT leads. Leads that talked to us in the last
// CALL_LIST_ACTIVE_DAYS come first (highest score, then most recent), then
// older HOT leads fill the remaining slots. A HOT lead who said yes two
// weeks ago and vanished belongs in "gone quiet", not at the top of today's
// calls. Won/lost never appear.
const selectCallList = (leads, { limit = CALL_LIST_SIZE, now = new Date(), activeDays = CALL_LIST_ACTIVE_DAYS } = {}) => {
  const activeSince = now.getTime() - activeDays * DAY_MS;
  const open = leads.filter((l) => l.scoreLabel === 'HOT' && !['CLOSED_WON', 'CLOSED_LOST'].includes(l.stage));
  const byScoreThenRecency = (a, b) => (b.aiScore || 0) - (a.aiScore || 0)
    || lastActivityAt(b) - lastActivityAt(a)
    || (new Date(b.updatedAt) - new Date(a.updatedAt));
  const active = open.filter((l) => lastActivityAt(l) >= activeSince).sort(byScoreThenRecency);
  const rest = open.filter((l) => lastActivityAt(l) < activeSince).sort(byScoreThenRecency);
  return dedupeByContact([...active, ...rest]).slice(0, limit);
};

// Follow-up split. `convs` are conversation rows with { status, aiEnabled,
// lastMessageAt, lead: { stage, aiScore, ... }, messages: [latest] }.
//   awaiting — a human owes them a reply: payment proof waiting for
//              verification, or the last message is THEIRS on a thread the
//              AI is no longer answering (handoff / AI off).
//   quiet    — WE spoke last and they've been silent QUIET_HOURS+, on an
//              open (not won/lost) lead within the lookback.
//
// hotOnly (default true) restricts the QUIET half to HOT leads. DSP's real
// numbers are why: every warm/cold lead that ever went quiet qualifies, which
// rendered "gone quiet (239)" every single morning — a figure that never
// moves is wallpaper, and the section stops being read. The awaiting half is
// never filtered: a human waiting on a reply matters whatever their score.
const splitFollowUps = (convs, now = new Date(), { quietHours = QUIET_HOURS, lookbackDays = LOOKBACK_DAYS, cap = LIST_CAP, hotOnly = true } = {}) => {
  const lookback = now.getTime() - lookbackDays * DAY_MS;
  const quietCutoff = now.getTime() - quietHours * HOUR_MS;
  const awaiting = [];
  const quiet = [];

  for (const c of convs) {
    const last = c.messages?.[0];
    const lastAt = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
    if (!lastAt || lastAt < lookback) continue;
    const stage = c.lead?.stage;
    if (stage === 'CLOSED_LOST') continue;

    const aiOff = c.status === 'HUMAN_TAKEOVER' || c.aiEnabled === false;
    if (c.status === 'PENDING_VERIFICATION' || (aiOff && last?.direction === 'INBOUND')) {
      awaiting.push(c);
      continue;
    }
    if (stage === 'CLOSED_WON' || c.status === 'CLOSED') continue;
    if (hotOnly && c.lead?.scoreLabel !== 'HOT') continue;
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
  quiet.sort((a, b) => (b.lead?.aiScore || 0) - (a.lead?.aiScore || 0)
    || new Date(a.lastMessageAt) - new Date(b.lastMessageAt));

  const awaitingU = dedupeByContact(awaiting, (c) => contactKey(c.lead) || c.id);
  const quietU = dedupeByContact(quiet, (c) => contactKey(c.lead) || c.id);
  return {
    awaiting: awaitingU.slice(0, cap), awaitingTotal: awaitingU.length,
    quiet: quietU.slice(0, cap), quietTotal: quietU.length,
  };
};

// Stalled = sitting in the current stage ≥ threshold days (and ≤ STALL_MAX_DAYS,
// past which it's cold rather than at-risk). Stage entry time comes from the
// newest lead_stage_history row for that lead; leads that predate the history
// table fall back to updatedAt. A lead also has to have actually talked to
// us within STALL_MAX_DAYS — a lead whose thread has been dead for a month
// isn't "at risk", it's gone, and DSP has 600+ of those in PROPOSED.
//
// hotOnly (default true) for the same reason as the quiet queue: a stalled
// count in the hundreds reads identically every morning and gets ignored. A
// stalled HOT lead is a real, actionable miss.
const findStalled = (leads, historyRows, now = new Date(), { thresholds = STALL_THRESHOLDS_DAYS, maxDays = STALL_MAX_DAYS, cap = LIST_CAP, hotOnly = true } = {}) => {
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
    if (hotOnly && lead.scoreLabel !== 'HOT') continue;
    if (lastActivityAt(lead) < activeSince) continue;
    const h = enteredAt.get(lead.id);
    // A history row for a different stage than the lead is in means the
    // latest transition wasn't recorded — fall back to updatedAt.
    const since = h && h.toStage === lead.stage ? h.createdAt : lead.updatedAt;
    const days = daysBetween(since, now);
    if (days >= threshold && days <= maxDays) out.push({ lead, days, threshold });
  }
  out.sort((a, b) => (b.lead.aiScore || 0) - (a.lead.aiScore || 0) || b.days - a.days);
  const unique = dedupeByContact(out, (x) => contactKey(x.lead));
  return { items: unique.slice(0, cap), total: unique.length };
};

// Yesterday's wins — paid only. enrollmentFee > 0 is the won-means-paid rule.
const summarizeWins = (wonLeads, currency) => {
  const paid = wonLeads.filter((l) => Number(l.enrollmentFee) > 0);
  const total = paid.reduce((n, l) => n + Number(l.enrollmentFee), 0);
  return { count: paid.length, total, currency, leads: paid };
};

// "Today's 3 highest-value actions", in order. Priority:
//   1. payment proof waiting for verification (money on the table)
//   2. the #1 call-list lead
//   3. a human-owed reply (handoff / AI off)
//   4. a paid student with no email (can't get course access)
//   5. the longest-stalled PROPOSED lead
//   6. the hottest gone-quiet lead
const rankActions = (s) => {
  const actions = [];
  const push = (text) => { if (text && actions.length < 3) actions.push(text); };

  const pv = s.followUps.awaiting.find((c) => c.status === 'PENDING_VERIFICATION');
  if (pv) push(`Verify the payment proof from ${displayName(pv.lead)} (${displayPhone(pv.lead)}) — a seat is waiting on you.`);

  const top = s.callList[0];
  if (top) push(`Call ${displayName(top)} (${displayPhone(top)}) — ${tierLabel(top)}. ${buildOpener(top)}`);

  const owed = s.followUps.awaiting.find((c) => c.status !== 'PENDING_VERIFICATION');
  if (owed) push(`Reply to ${displayName(owed.lead)} (${displayPhone(owed.lead)}) — waiting ${ago(owed.lastMessageAt, s.now)} with the AI off.`);

  const ne = s.needsEmail[0];
  if (ne) push(`Get an email from ${displayName(ne)} (${displayPhone(ne)}) — paid, but no course access until you have it.`);

  const stalled = s.stalled.items.find((x) => x.lead.stage === 'PROPOSED') || s.stalled.items[0];
  if (stalled) push(`Nudge ${displayName(stalled.lead)} (${displayPhone(stalled.lead)}) — ${stalled.days} days in ${stageLabel(stalled.lead.stage)}.`);

  const q = s.followUps.quiet[0];
  if (q) push(`Re-open ${displayName(q.lead)} (${displayPhone(q.lead)}) — you spoke last, silent ${ago(q.lastMessageAt, s.now)}.`);

  return actions;
};

const isEmptyDigest = (s) => s.newLeads.length === 0
  && s.callList.length === 0
  && s.followUps.awaitingTotal === 0
  && s.followUps.quietTotal === 0
  && s.stalled.total === 0
  && s.wins.count === 0
  && s.needsEmail.length === 0;

// ── Rendering (pure) ─────────────────────────────────────────────────
// Produces a channel-neutral structure: [{ title, lines:[{ text, url? }], note? }]
// plus the ranked actions. email.service turns it into HTML; renderText
// flattens it for the plain-text part and the dry-run.

const more = (shown, total) => (total > shown ? `…and ${total - shown} more in the dashboard` : null);

const buildSections = (s) => {
  const sections = [];

  sections.push({
    title: `New leads since yesterday (${s.newLeads.length})`,
    lines: s.newLeads.slice(0, LIST_CAP).map((l) => ({
      text: `${displayName(l)} ${displayPhone(l)} — ${tierLabel(l)} — ${problemLine(l)}`,
      url: conversationUrl(l.conversations?.[0]?.id),
    })),
    note: s.newLeads.length ? more(Math.min(LIST_CAP, s.newLeads.length), s.newLeads.length) : 'No new leads overnight.',
  });

  sections.push({
    title: `Today's call list (${s.callList.length})`,
    lines: s.callList.map((l, i) => {
      const said = lastInboundText(l);
      const saidLine = said ? `\n   Last said: "${oneLine(said, 100)}" (${ago(l.conversations[0].messages[0].sentAt, s.now)})` : '';
      return {
        text: `${i + 1}. ${displayName(l)} ${displayPhone(l)} — ${tierLabel(l)}\n   Problem: ${problemLine(l)}${saidLine}\n   Opener: ${buildOpener(l)}`,
        url: conversationUrl(l.conversations?.[0]?.id),
      };
    }),
    note: s.callList.length ? null : 'No open HOT leads right now.',
  });

  const fu = s.followUps;
  sections.push({
    title: `Follow-up queue — awaiting your reply (${fu.awaitingTotal})`,
    lines: fu.awaiting.map((c) => ({
      text: `${displayName(c.lead)} ${displayPhone(c.lead)} — ${c.status === 'PENDING_VERIFICATION' ? '💳 payment proof to verify' : 'last message is theirs, AI off'} — ${ago(c.lastMessageAt, s.now)}`,
      url: conversationUrl(c.id),
    })),
    note: fu.awaitingTotal ? more(fu.awaiting.length, fu.awaitingTotal) : 'Nobody is waiting on a human reply.',
  });
  sections.push({
    title: `Hot leads gone quiet ${QUIET_HOURS}h+ after we spoke last (${fu.quietTotal})`,
    lines: fu.quiet.map((c) => ({
      text: `${displayName(c.lead)} ${displayPhone(c.lead)} — ${tierLabel(c.lead)} — silent ${ago(c.lastMessageAt, s.now)} — ${problemLine(c.lead)}`,
      url: conversationUrl(c.id),
    })),
    note: fu.quietTotal ? more(fu.quiet.length, fu.quietTotal) : 'No hot lead has gone quiet on us.',
  });

  sections.push({
    title: `At-risk — hot leads stalled in a stage (${s.stalled.total})`,
    lines: s.stalled.items.map(({ lead, days }) => ({
      text: `${displayName(lead)} ${displayPhone(lead)} — ${days} days in ${stageLabel(lead.stage)} — ${tierLabel(lead)}`,
      url: conversationUrl(lead.conversations?.[0]?.id),
    })),
    note: s.stalled.total ? more(s.stalled.items.length, s.stalled.total) : 'No hot lead is sitting too long in a stage.',
  });

  const w = s.wins;
  sections.push({
    title: 'Yesterday\'s wins',
    lines: w.count
      ? [{ text: `${w.count} paid — ${money(w.total, w.currency)}` }, ...w.leads.slice(0, LIST_CAP).map((l) => ({ text: `${displayName(l)} — ${money(l.enrollmentFee, w.currency)}` }))]
      : [],
    note: w.count ? null : 'No payments recorded yesterday.',
  });

  if (s.needsEmail.length) {
    sections.push({
      title: `Paid but no email yet (${s.needsEmail.length})`,
      lines: s.needsEmail.slice(0, LIST_CAP).map((l) => ({
        text: `${displayName(l)} ${displayPhone(l)} — collect their email on WhatsApp so course access can be created`,
        url: conversationUrl(l.conversations?.[0]?.id),
      })),
      note: more(Math.min(LIST_CAP, s.needsEmail.length), s.needsEmail.length),
    });
  }

  return sections;
};

const buildDigest = (s, tenant) => {
  const brand = tenant?.name || 'ASOS';
  const dayLabel = pktDayLabel(s.now);
  const empty = isEmptyDigest(s);
  return {
    brand,
    dayLabel,
    empty,
    subject: empty ? `Nothing needs you today — ${brand}` : `Today's call list — ${brand}`,
    sections: empty ? [] : buildSections(s),
    actions: empty ? [] : rankActions(s),
    counts: {
      newLeads: s.newLeads.length,
      callList: s.callList.length,
      awaiting: s.followUps.awaitingTotal,
      quiet: s.followUps.quietTotal,
      stalled: s.stalled.total,
      wins: s.wins.count,
      winsTotal: s.wins.total,
      currency: s.wins.currency,
      needsEmail: s.needsEmail.length,
    },
    dashboardUrl: env.APP_URL,
  };
};

// Plain-text rendering — used for the email text part and the dry-run.
const renderText = (d) => {
  const out = [`☀️ Daily digest — ${d.brand}`, d.dayLabel, ''];
  if (d.empty) {
    out.push('Nothing needs you today — no new leads, no open hot leads, nobody waiting on a reply, nothing stalled.');
    out.push('', `Dashboard: ${d.dashboardUrl}`);
    return out.join('\n');
  }
  for (const sec of d.sections) {
    out.push(sec.title.toUpperCase());
    for (const line of sec.lines) out.push(`• ${line.text}`);
    if (sec.note) out.push(`  ${sec.note}`);
    out.push('');
  }
  out.push('TODAY\'S 3 HIGHEST-VALUE ACTIONS');
  d.actions.forEach((a, i) => out.push(`${i + 1}. ${a}`));
  out.push('', `Dashboard: ${d.dashboardUrl}`);
  return out.join('\n');
};

// Short WhatsApp pointer. Meta template params can't carry newlines, so
// the same seven values feed both the free-form text and the template.
const waParams = (d) => {
  const c = d.counts;
  return [
    d.brand,
    String(c.newLeads),
    String(c.callList),
    String(c.awaiting),
    String(c.stalled),
    c.wins ? `${c.wins} paid, ${money(c.winsTotal, c.currency)}` : 'no payments',
    d.actions[0] ? oneLine(d.actions[0], 140) : 'nothing needs you today',
  ];
};

const renderWhatsAppText = (d) => {
  const p = waParams(d);
  return `☀️ *Daily digest — ${p[0]}*\n${d.dayLabel}\n\n🆕 ${p[1]} new leads\n📞 ${p[2]} to call today\n💬 ${p[3]} awaiting your reply\n⏳ ${p[4]} stalled\n🏆 Yesterday: ${p[5]}\n\n*Top action:* ${p[6]}\n\nFull list is in your inbox.`;
};

// ── Data collection (per tenant, inside its RLS context) ─────────────

const leadInclude = {
  contact: { select: { id: true, name: true, phone: true, email: true } },
  conversations: {
    orderBy: { lastMessageAt: 'desc' }, take: 1,
    select: {
      id: true, status: true, aiEnabled: true, lastMessageAt: true,
      messages: { where: { direction: 'INBOUND' }, orderBy: { sentAt: 'desc' }, take: 1, select: { content: true, sentAt: true } },
    },
  },
};

const collectSections = async (tenantId, tenant, now = new Date()) => {
  const { todayStart, yesterdayStart } = pktDayBounds(now);
  const lookback = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  const currency = tenantCurrency(tenant);

  const [newLeads, hotLeadsActive, followUpConvs, openLeads, wonYesterday, needsEmail] = await Promise.all([
    // 1. Overnight / new leads since the last digest.
    prisma.lead.findMany({
      where: { tenantId, createdAt: { gte: new Date(now.getTime() - NEW_LEADS_WINDOW_MS) } },
      orderBy: [{ aiScore: 'desc' }, { createdAt: 'desc' }],
      include: leadInclude,
    }),
    // 2. Call-list candidates — same selection as leads.service getHotLeads,
    //    but restricted to leads who talked to us this week. Ordering the
    //    whole HOT pool by score alone surfaced only the score-100 leads who
    //    said "yes" a fortnight ago and vanished; selectCallList tops up from
    //    the older pool (hotLeadsOlder) only when this comes up short.
    prisma.lead.findMany({
      where: {
        tenantId, scoreLabel: 'HOT', stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
        conversations: { some: { lastMessageAt: { gte: new Date(now.getTime() - CALL_LIST_ACTIVE_DAYS * DAY_MS) } } },
      },
      orderBy: [{ aiScore: 'desc' }, { updatedAt: 'desc' }],
      take: CALL_LIST_SIZE * 4,
      include: leadInclude,
    }),
    // 3. Follow-up candidates: anything with activity in the lookback that a
    //    human might owe a reply on, or that we spoke last on.
    prisma.conversation.findMany({
      where: {
        tenantId,
        lastMessageAt: { gte: lookback },
        lead: { stage: { not: 'CLOSED_LOST' } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 400,
      select: {
        id: true, status: true, aiEnabled: true, lastMessageAt: true,
        lead: { select: { id: true, stage: true, aiScore: true, scoreLabel: true, problemSummary: true, contact: { select: { name: true, phone: true } } } },
        messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { direction: true, sentAt: true, content: true } },
      },
    }),
    // 4. Stall candidates: every open lead in a stage that can stall.
    prisma.lead.findMany({
      where: { tenantId, stage: { in: OPEN_STAGES } },
      select: {
        id: true, stage: true, aiScore: true, scoreLabel: true, updatedAt: true,
        contact: { select: { name: true, phone: true } },
        conversations: { orderBy: { lastMessageAt: 'desc' }, take: 1, select: { id: true, lastMessageAt: true } },
      },
    }),
    // 5. Yesterday's wins (PKT calendar day), paid only.
    prisma.lead.findMany({
      where: { tenantId, stage: 'CLOSED_WON', closedAt: { gte: yesterdayStart, lt: todayStart }, enrollmentFee: { gt: 0 } },
      select: { id: true, enrollmentFee: true, contact: { select: { name: true, phone: true } } },
    }),
    // 6. Paid Mastery students with no email on file.
    prisma.lead.findMany({
      where: { tenantId, stage: 'CLOSED_WON', product: 'MASTERY', contact: { OR: [{ email: null }, { email: '' }] } },
      orderBy: { closedAt: 'desc' },
      include: leadInclude,
    }),
  ]);

  // Top up the call list from older HOT leads only if this week's pool is thin.
  const hotLeadsOlder = dedupeByContact(hotLeadsActive).length >= CALL_LIST_SIZE ? [] : await prisma.lead.findMany({
    where: { tenantId, scoreLabel: 'HOT', stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] }, id: { notIn: hotLeadsActive.map((l) => l.id) } },
    orderBy: [{ aiScore: 'desc' }, { updatedAt: 'desc' }],
    take: CALL_LIST_SIZE * 4,
    include: leadInclude,
  });
  const hotLeads = [...hotLeadsActive, ...hotLeadsOlder];

  // Stage-entry times for the stall candidates (newest row first per lead).
  const openIds = openLeads.map((l) => l.id);
  const historyRows = openIds.length
    ? await prisma.leadStageHistory.findMany({
      where: { tenantId, leadId: { in: openIds } },
      orderBy: { createdAt: 'desc' },
      select: { leadId: true, toStage: true, createdAt: true },
    })
    : [];

  // Follow-up rows use lead.contact; make them look like leads for the
  // shared display helpers.
  const convs = followUpConvs.map((c) => ({ ...c, lead: { ...c.lead, contact: c.lead?.contact } }));

  return {
    now,
    newLeads: dedupeByContact(newLeads),
    callList: selectCallList(hotLeads, { now }),
    followUps: splitFollowUps(convs, now),
    stalled: findStalled(openLeads, historyRows, now),
    wins: summarizeWins(wonYesterday, currency),
    needsEmail: dedupeByContact(needsEmail),
  };
};

// ── Eligibility + delivery ───────────────────────────────────────────

const dailyPrefs = (tenant) => {
  const p = (tenant?.settings?.notifPrefs || {}).daily || {};
  return { email: p.email === true, whatsapp: p.whatsapp === true };
};

const emailRecipients = async (tenant) => {
  const s = tenant.settings || {};
  if (s.alertEmail) return [s.alertEmail];
  if (s.digestEmail) return [s.digestEmail];
  const admins = await prisma.user.findMany({
    where: { tenantId: tenant.id, isActive: true, role: 'TENANT_ADMIN' },
    select: { email: true },
  });
  return admins.map((a) => a.email).filter(Boolean);
};

// Cheap pre-filter run under system scope: is there any point entering this
// tenant's context? Email recipients (alertEmail → digestEmail → admin users)
// are resolved inside sendDailyDigest; a tenant with the email pref on but no
// address anywhere comes back as skipped:'no_recipients'.
const isEligible = (tenant) => {
  const p = dailyPrefs(tenant);
  const s = tenant.settings || {};
  return p.email || (p.whatsapp && !!s.adminPhone);
};

const lockKey = (tenantId, now) => `daily-digest:${tenantId}:${pktDayKey(now)}`;

// One digest per tenant per PKT day, across retries and worker restarts.
const acquireLock = async (tenantId, now) => {
  const res = await redis.set(lockKey(tenantId, now), '1', 'EX', LOCK_TTL_SECONDS, 'NX');
  return res === 'OK';
};
const releaseLock = (tenantId, now) => redis.del(lockKey(tenantId, now)).catch(() => {});

/**
 * Build (and unless dryRun, deliver) the daily digest for one tenant.
 * Returns a result object, never throws for a per-tenant problem.
 *
 * @param {string} tenantId
 * @param {object} opts
 * @param {boolean} opts.dryRun  build + return text, send nothing, take no lock
 * @param {boolean} opts.force   manual "send now": ignore the pref gate and the
 *                               daily lock (Resend still dedupes per minute)
 * @param {Date}    opts.now
 */
const sendDailyDigest = async (tenantId, { dryRun = false, force = false, now = new Date() } = {}) => requestContext.run(
  { requestId: `daily-digest:${tenantId}`, tenantId },
  async () => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return { tenantId, skipped: 'tenant_not_found' };

    const settings = tenant.settings || {};
    const prefs = dailyPrefs(tenant);
    const wantEmail = force || prefs.email;
    const wantWa = force ? !!settings.adminPhone : prefs.whatsapp;
    if (!wantEmail && !wantWa) return { tenantId, skipped: 'disabled' };

    const recipients = wantEmail ? await emailRecipients(tenant) : [];
    const adminPhone = wantWa ? settings.adminPhone : null;
    if (recipients.length === 0 && !adminPhone) return { tenantId, skipped: 'no_recipients' };

    const sections = await collectSections(tenantId, tenant, now);
    const digest = buildDigest(sections, tenant);
    const text = renderText(digest);

    if (dryRun) {
      return { tenantId, dryRun: true, empty: digest.empty, counts: digest.counts, recipients: recipients.length, whatsapp: !!adminPhone, text };
    }

    if (!force && !(await acquireLock(tenantId, now))) {
      return { tenantId, skipped: 'already_sent_today' };
    }

    const result = { tenantId, empty: digest.empty, counts: digest.counts, email: { sent: 0, failed: 0 }, whatsapp: null };

    // ── Email (primary) ──────────────────────────────────────────────
    if (recipients.length) {
      if (emailService.isDigestEmailConfigured()) {
        for (const to of recipients) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await emailService.sendDailyDigestEmail({
              to, digest, text, day: pktDayKey(now), manual: force,
            });
            result.email.sent += 1;
          } catch (err) {
            result.email.failed += 1;
            logger.warn({ err, tenantId }, 'Daily digest email failed');
          }
        }
      } else {
        result.email.skipped = 'not_configured';
      }
    }

    // ── WhatsApp (secondary, short pointer) ──────────────────────────
    if (adminPhone) {
      const tpl = settings.dailyDigest?.waTemplate;
      try {
        if (tpl?.name) {
          const params = waParams(digest).map((t) => ({ type: 'text', text: t }));
          await whatsappService.sendTemplate(tenant, adminPhone, tpl.name, tpl.language || 'en', [{ type: 'body', parameters: params }]);
          result.whatsapp = { sent: true, via: 'template' };
        } else {
          await whatsappService.sendText(tenant, adminPhone, renderWhatsAppText(digest));
          result.whatsapp = { sent: true, via: 'text' };
        }
      } catch (err) {
        // Expected outside Meta's 24h window (131047) when no template is
        // configured. Email already carries the digest — record, don't throw.
        result.whatsapp = { sent: false, error: String(err?.response?.data?.error?.message || err?.message || err).slice(0, 200) };
        logger.info({ tenantId, via: tpl?.name ? 'template' : 'text' }, 'Daily digest WhatsApp copy not delivered');
      }
    }

    // Nothing went out at all (e.g. Resend down and WhatsApp closed) — drop
    // the lock so a retry can deliver instead of being swallowed as a dupe.
    if (!force && result.email.sent === 0 && !result.whatsapp?.sent) await releaseLock(tenantId, now);

    logger.info({ tenantId, ...result }, '☀️ Daily digest processed');
    return result;
  }
);

// Cross-tenant 09:00 run. Reads the tenant list under system scope, then
// enters each tenant's own RLS context via sendDailyDigest.
const runDailyDigestForAllTenants = async ({ dryRun = false, now = new Date() } = {}) => runWithSystemScope(async () => {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, settings: true } });
  const targets = tenants.filter(isEligible);
  logger.info({ tenantCount: targets.length, dryRun }, '☀️ Daily digest run starting');

  const results = [];
  for (const t of targets) {
    // Sequential — a handful of tenants, and it keeps WhatsApp sends spaced.
    // eslint-disable-next-line no-await-in-loop
    results.push(await sendDailyDigest(t.id, { dryRun, now }).catch((err) => {
      logger.error({ err, tenantId: t.id }, 'Daily digest failed for tenant');
      return { tenantId: t.id, error: err.message };
    }));
  }

  const summary = {
    tenants: results.length,
    emailsSent: results.reduce((n, r) => n + (r.email?.sent || 0), 0),
    emailsFailed: results.reduce((n, r) => n + (r.email?.failed || 0), 0),
    waSent: results.filter((r) => r.whatsapp?.sent).length,
    skipped: results.filter((r) => r.skipped).length,
    errors: results.filter((r) => r.error).length,
  };
  logger.info(summary, '☀️ Daily digest run finished');
  return summary;
});

module.exports = {
  // pure — unit tested
  pktDayKey, pktDayBounds, selectCallList, dedupeByContact, buildOpener, splitFollowUps, findStalled,
  summarizeWins, rankActions, isEmptyDigest, buildSections, buildDigest, renderText,
  renderWhatsAppText, waParams, dailyPrefs, isEligible, problemLine,
  STALL_THRESHOLDS_DAYS, STALL_MAX_DAYS, QUIET_HOURS, CALL_LIST_SIZE, CALL_LIST_ACTIVE_DAYS, LIST_CAP,
  // IO
  collectSections, sendDailyDigest, runDailyDigestForAllTenants,
};
