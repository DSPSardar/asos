// src/services/agent-guards/won-guard.js
//
// CLOSED_WON is money in the bank, not a sentence in a chat. For a tenant with
// the Mastery integration (MASTERY_TENANT_ID) the only writers of CLOSED_WON
// are the Mastery webhook (enrolment approved in the course admin) and a human
// in the dashboard. The AI pipeline must never set it — this guard sits on the
// closer's stage-update path and holds the lead at PROPOSED instead.
//
// Pure: no DB, no network. The worker and claude.service both call it.

const env = require('../../config/env');
const logger = require('../../utils/logger');

const EV = 'won-guard';

/** Tenants whose won-stage is owned by the Mastery webhook / humans only. */
const isMasteryGuardedTenant = (tenantId, guardedTenantId = env.MASTERY_TENANT_ID) =>
  Boolean(guardedTenantId) && String(tenantId) === String(guardedTenantId);

/**
 * Decide the stage the AI is allowed to write.
 *
 * @returns {{ stage: string, blocked: boolean, reason: string|null }}
 */
const guardAiStageTransition = ({ tenantId, leadId = null, fromStage, toStage, guardedTenantId = env.MASTERY_TENANT_ID }) => {
  if (toStage !== 'CLOSED_WON') return { stage: toStage, blocked: false, reason: null };
  if (fromStage === 'CLOSED_WON') return { stage: toStage, blocked: false, reason: null }; // already won by a human/webhook — nothing to guard
  if (!isMasteryGuardedTenant(tenantId, guardedTenantId)) return { stage: toStage, blocked: false, reason: null };

  const stage = 'PROPOSED';
  logger.warn({ ev: EV, tenantId, leadId, fromStage, attempted: toStage, stage },
    'AI attempted to set CLOSED_WON — blocked; only the Mastery webhook or a human may set it');
  return { stage, blocked: true, reason: 'ai_cannot_set_won' };
};

module.exports = { guardAiStageTransition, isMasteryGuardedTenant, EV };
