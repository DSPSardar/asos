// src/services/mastery.service.js
//
// Bridge between ASOS (sales) and DSP AI Agent Mastery (the self-paced course
// on digitalservicesprogram.com). Two directions:
//
//   ASOS → course : a MASTERY lead reaches CLOSED_WON (payment verified) →
//                   POST the student to the course's enrol API, which creates
//                   their account and emails the sign-in link.
//   course → ASOS : the course posts learning events (module complete, badge,
//                   capstone…) to /webhooks/mastery; those become Activity rows
//                   that the automation engine can trigger WhatsApp nudges from.
//
// Everything here is best-effort and never throws into the caller: a failed
// enrol call is recorded as a SYSTEM activity so an admin can retry from the
// course's own admin page. Sales-side state (CLOSED_WON, fee) is the source of
// truth and must never be rolled back because the course API was unreachable.

const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../utils/logger');

const isMasteryLead = (lead) => String(lead?.product || '').toUpperCase() === 'MASTERY';

const configured = () => Boolean(env.MASTERY_ENROL_URL && env.MASTERY_ENROL_SECRET);

/**
 * Enrol a paid lead into the course. Safe to call on every CLOSED_WON path;
 * it no-ops for non-Mastery leads or when the integration isn't configured.
 * Returns { skipped: reason } | { ok: true } | { error }.
 */
const enrolIfMastery = async ({ tenantId, leadId, userId = null }) => {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: { id: true, product: true, stage: true, enrollmentFee: true, currency: true,
      contact: { select: { name: true, email: true, phone: true } } },
  });
  if (!lead) return { skipped: 'lead_not_found' };
  if (!isMasteryLead(lead)) return { skipped: 'not_mastery' };
  if (lead.stage !== 'CLOSED_WON') return { skipped: 'not_won' };
  if (!configured()) { logger.warn({ leadId }, 'Mastery enrol skipped: MASTERY_ENROL_URL/SECRET not set'); return { skipped: 'not_configured' }; }

  const email = (lead.contact?.email || '').trim().toLowerCase();
  if (!email) {
    await prisma.activity.create({ data: { tenantId, leadId, userId, type: 'SYSTEM',
      content: '⚠️ Paid for AI Agent Mastery but no email on the contact — add their email, then re-confirm to enrol',
      metadata: { flag: 'mastery_enrol_missing_email' } } }).catch(() => {});
    return { error: 'missing_email' };
  }

  try {
    const res = await fetch(env.MASTERY_ENROL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mastery-secret': env.MASTERY_ENROL_SECRET },
      body: JSON.stringify({ email, full_name: lead.contact?.name || null, phone: lead.contact?.phone || null,
        source: 'asos', asos_lead_id: lead.id, fee: lead.enrollmentFee, currency: lead.currency }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    await prisma.activity.create({ data: { tenantId, leadId, userId, type: 'SYSTEM',
      content: `🎓 Enrolled in AI Agent Mastery — sign-in email sent to ${email}`,
      metadata: { flag: 'mastery_enrolled', support_until: body.support_until || null } } }).catch(() => {});
    logger.info({ leadId, email }, 'Mastery: lead enrolled');
    return { ok: true };
  } catch (err) {
    logger.error({ err, leadId }, 'Mastery enrol failed');
    await prisma.activity.create({ data: { tenantId, leadId, userId, type: 'SYSTEM',
      content: `⚠️ AI Agent Mastery enrolment failed (${err.message}) — enrol manually from the course admin page`,
      metadata: { flag: 'mastery_enrol_failed', error: err.message } } }).catch(() => {});
    return { error: err.message };
  }
};

/** Fire-and-forget wrapper for the two CLOSED_WON paths. */
const enrolIfMasteryAsync = (args) => { enrolIfMastery(args).catch((err) => logger.error({ err }, 'Mastery enrol crashed')); };

/**
 * Record a learning event from the course as a SYSTEM activity on the lead.
 * The automation engine's `mastery_event` trigger matches on metadata.masteryEvent.
 * Returns the lead id, or null if no contact with that email exists in the tenant.
 */
const recordEvent = async ({ tenantId, email, event, data = {} }) => {
  const contact = await prisma.contact.findFirst({
    where: { tenantId, email: { equals: email, mode: 'insensitive' } },
    select: { id: true, leads: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } } },
  });
  const leadId = contact?.leads?.[0]?.id;
  if (!leadId) return null;
  const labels = {
    enrolled: '🎓 Enrolled in AI Agent Mastery',
    module_complete: `✅ Completed module ${data.module || ''}`.trim(),
    badge_earned: `🏅 Earned badge: ${data.badge || ''}`.trim(),
    capstone_submitted: '📦 Capstone submitted for review',
    capstone_approved: '🎉 Capstone approved — certificate issued',
    inactive: `💤 No dashboard activity for ${data.days || 7} days`,
  };
  await prisma.activity.create({ data: { tenantId, leadId, type: 'SYSTEM',
    content: labels[event] || `Mastery event: ${event}`,
    metadata: { masteryEvent: event, ...data } } });
  return leadId;
};

module.exports = { enrolIfMastery, enrolIfMasteryAsync, recordEvent, isMasteryLead };
