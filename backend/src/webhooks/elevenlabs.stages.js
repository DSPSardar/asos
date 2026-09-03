// src/webhooks/elevenlabs.stages.js
//
// The stage rules for the WhatsApp voice agent's lead webhook, kept in their
// own module with no database or config imports so they can be unit-tested
// without standing up Prisma. elevenlabs.webhook.js is the only caller.

// Agent-reported funnel position → pipeline stage. Capped at PROPOSED on
// purpose: this endpoint must never be able to write a win. "Won means paid"
// is settled by the payment-proof flow and the Mastery enrol webhook, not by
// a caller saying they have paid.
const STAGE_MAP = {
  new:             'NEW',
  qualified:       'QUALIFYING',
  objection:       'QUALIFYING',
  email_captured:  'DIAGNOSED',
  link_sent:       'PROPOSED',
  paid:            'PROPOSED',
};

// Pipeline order, used to stop a later call from walking a lead backwards.
const STAGE_RANK = { NEW: 0, QUALIFYING: 1, DIAGNOSED: 2, PROPOSED: 3, CLOSED_WON: 4, CLOSED_LOST: 4 };
const TERMINAL = new Set(['CLOSED_WON', 'CLOSED_LOST']);

/**
 * Pure: given a lead's current stage (null for a brand-new lead) and the stage
 * the agent reports, decide where the lead lands.
 *
 * @returns {{ target: string, advance: boolean }} target is the mapped stage;
 *          advance is false when the lead must stay where it is.
 */
const resolveStage = (currentStage, reportedStage) => {
  const target = STAGE_MAP[reportedStage];
  if (!currentStage) return { target, advance: true };
  // Terminal leads are read-only here: an enrolled student asking a question
  // must never be dragged back into the pipeline, and a lost lead is reopened
  // by a human, not by an agent's stage guess.
  if (TERMINAL.has(currentStage)) return { target, advance: false };
  return { target, advance: STAGE_RANK[target] > STAGE_RANK[currentStage] };
};

module.exports = { STAGE_MAP, STAGE_RANK, TERMINAL, resolveStage };
