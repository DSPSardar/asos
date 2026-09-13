// src/services/automation.steps.js
// Pure sequence logic for the automation engine — no database, no network —
// so the step/cancel rules can be unit-tested without Prisma
// (test/automation-sequences.test.js). automation.service.js does the IO.
//
// A rule's action may carry `steps`: [{ delay, unit, template, waTemplate? }].
// Step 0 fires when the trigger matches (exactly what a plain rule does);
// each later step fires `delay` after the PREVIOUS touch, unless the lead
// replied in between. A rule without `steps` is a one-step sequence.

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
const delayMs = (t) => (Number(t?.delay) || 0) * (UNIT_MS[t?.unit] || UNIT_MS.hours);

const UNTOUCHABLE_CONV = ['HUMAN_TAKEOVER', 'PENDING_VERIFICATION'];
const CANCEL_REASONS = { replied: 'lead_replied', agent: 'agent_active', ineligible: 'ineligible', suppressed: 'suppressed' };
// Hard cap on touches per sequence — a lead who has not answered three
// automated messages is not going to answer a fourth.
const MAX_STEPS = 3;

// Normalise a rule's action into an ordered list of touches. A legacy rule
// ({ template, waTemplate }) becomes a single step with delay 0. When
// action.steps exists it is the whole sequence; step 0's delay is ignored
// because the trigger already carries the "when" of the first touch.
const normalizeSteps = (action = {}) => {
  const raw = (Array.isArray(action.steps) && action.steps.length
    ? action.steps
    : [{ delay: 0, unit: 'hours', template: action.template, waTemplate: action.waTemplate }]
  ).slice(0, MAX_STEPS); // never more than MAX_STEPS touches, whatever was saved
  return raw.map((s, i) => ({
    index: i,
    delay: i === 0 ? 0 : Math.max(0, Number(s.delay) || 0),
    unit: UNIT_MS[s.unit] ? s.unit : 'hours',
    template: s.template || action.template || '',
    waTemplate: s.waTemplate?.name ? s.waTemplate : null,
  }));
};

// Validation the API applies on save. Every touch after the first lands
// ≥ delay after we last spoke — always outside Meta's 24h window — so it
// MUST name an approved template or it can never deliver (error 131047).
const validateSteps = (action = {}) => {
  const steps = normalizeSteps(action);
  const problems = [];
  // normalizeSteps truncates silently at runtime; on save, tell the admin.
  const rawCount = Array.isArray(action.steps) ? action.steps.length : 1;
  if (rawCount > MAX_STEPS) problems.push(`a sequence can have at most ${MAX_STEPS} touches`);
  steps.forEach((s, i) => {
    if (i === 0) return;
    if (delayMs(s) <= 0) problems.push(`step ${i + 1}: delay must be greater than 0`);
    if (!s.waTemplate) problems.push(`step ${i + 1}: an approved WhatsApp template is required — a follow-up touch is always outside the 24h window`);
    if (!s.template || String(s.template).trim().length < 5) problems.push(`step ${i + 1}: message text is required`);
  });
  return problems;
};

// What the enrolment row should look like after touch `stepIndex` went out.
const planAfterTouch = (steps, stepIndex, now = new Date()) => {
  const next = steps[stepIndex + 1];
  if (!next) return { status: 'SENT', step: stepIndex + 1, nextDueAt: null, lastTouchAt: now };
  return { status: 'ACTIVE', step: stepIndex + 1, nextDueAt: new Date(now.getTime() + delayMs(next)), lastTouchAt: now };
};

// Should a pending touch still go out? Returns null to proceed, or the
// cancel reason. `facts` = { lastInboundAt, lastAgentAt } for the whole
// thread; `since` = when the previous touch went out. excludeWon mirrors
// baseLeadWhere: chase rules stop at CLOSED_WON, lifecycle rules don't.
const cancelReasonFor = ({ lead, conv, facts, since, excludeWon, sales = excludeWon }) => {
  if (!lead || !conv) return CANCEL_REASONS.ineligible;
  if (lead.stage === 'CLOSED_LOST' || (excludeWon && lead.stage === 'CLOSED_WON')) return CANCEL_REASONS.ineligible;
  if (isSuppressed(lead, { sales })) return CANCEL_REASONS.suppressed;
  if (!conv.aiEnabled || UNTOUCHABLE_CONV.includes(conv.status)) return CANCEL_REASONS.ineligible;
  const after = (t) => t && since && new Date(t) > new Date(since);
  if (after(facts?.lastInboundAt)) return CANCEL_REASONS.replied;
  if (after(facts?.lastAgentAt)) return CANCEL_REASONS.agent;
  return null;
};

const isChaseTrigger = (rule) => ['no_reply', 'no_activity'].includes(rule?.trigger?.type);

// ── Suppression lists ─────────────────────────────────────────────────
// A SALES rule (No-Reply Follow-up, Cold Lead Re-engage, Unpaid Enrollment
// Reminder…) is any rule that is not a lifecycle nudge for enrolled
// students: the chase triggers, and stage_entered for a pre-won stage.
// mastery_event / dsp_phase_changed / stage_entered CLOSED_WON are lifecycle.
//
// Every rule skips opted-out contacts. Sales rules additionally skip:
//   CLOSED_WON, CLOSED_LOST (any reason — refund/duplicate included),
//   formSubmittedAt set, "already enrolled", and opt-outs.
const LOST_REASON_SUPPRESS = /refund|duplicate/i;
const isSalesRule = (rule) => {
  const t = rule?.trigger || {};
  if (isChaseTrigger(rule)) return true;
  if (t.type === 'stage_entered') return t.stage !== 'CLOSED_WON';
  return false;
};

// Prisma `where` fragment for findMatches. Pure data — asserted in tests.
const suppressionWhere = (rule) => {
  const where = { contact: { optedOutAt: null } };
  if (isSalesRule(rule)) {
    where.formSubmittedAt = null;
    where.alreadyEnrolledAt = null;
  }
  return where;
};

// Same rules, evaluated on a loaded lead (advanceDue re-check).
const isSuppressed = (lead, { sales = true } = {}) => {
  if (!lead) return true;
  if (lead.contact?.optedOutAt) return true;
  if (!sales) return false;
  if (lead.stage === 'CLOSED_WON') return true;
  if (lead.stage === 'CLOSED_LOST') return true; // refund / duplicate / any other reason
  if (lead.formSubmittedAt || lead.alreadyEnrolledAt) return true;
  return false;
};

module.exports = {
  UNIT_MS, delayMs, UNTOUCHABLE_CONV, CANCEL_REASONS, MAX_STEPS, LOST_REASON_SUPPRESS,
  normalizeSteps, validateSteps, planAfterTouch, cancelReasonFor, isChaseTrigger,
  isSalesRule, suppressionWhere, isSuppressed,
};
