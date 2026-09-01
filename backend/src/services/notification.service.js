// src/services/notification.service.js
// Handles admin alerts for key lead events — WhatsApp first, email fallback.
//
// Tenant settings used (all under tenant.settings JSON):
//   adminPhone  — digits-only WhatsApp number for admin alerts
//   notifPrefs  — { [eventType]: { whatsapp: bool, browser: bool } }
//   alertEmail  — optional; receives hotLead/needsHuman alerts whenever the
//                 WhatsApp copy did NOT go out (no phone, quiet hours, or the
//                 send failed — e.g. Meta's 24h customer-service window is
//                 closed for the admin's own number). Email is a fallback,
//                 not a second copy: a delivered WhatsApp suppresses it.
//   quietHours  — optional { enabled, start: 'HH:MM', end: 'HH:MM', tz }.
//                 Suppresses non-urgent WhatsApp pings (hotLead/newLead/
//                 unansweredQuestion) inside the window; needsHuman always
//                 goes through (payment verification can't wait), and the
//                 email fallback still fires so nothing is lost.

const whatsappService = require('./whatsapp.service');
const emailService = require('./email.service');
const logger = require('../utils/logger');

// Events that ignore quiet hours entirely.
const URGENT_EVENTS = new Set(['needsHuman']);
// Events important enough to fall back to email when WhatsApp didn't go out.
const EMAIL_FALLBACK_EVENTS = new Set(['hotLead', 'needsHuman']);

const DEFAULT_TZ = 'Asia/Karachi';

// 'HH:MM' → minutes since midnight, or null when malformed.
const minutesOfDay = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

// Current minutes-since-midnight in a named timezone. Intl is the only
// dependency-free way to do tz math in Node; hourCycle h23 avoids the
// "24:xx" quirk some ICU versions produce at midnight.
const localMinutes = (tz, now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const min = Number(parts.find((p) => p.type === 'minute')?.value);
  return (h % 24) * 60 + min;
};

// Pure: is `now` inside the tenant's quiet-hours window?
// Supports overnight spans (start 23:00, end 08:00). A malformed or disabled
// config never suppresses — fail open, alerts matter more than silence.
const inQuietHours = (quietHours, now = new Date()) => {
  if (!quietHours || !quietHours.enabled) return false;
  const start = minutesOfDay(quietHours.start);
  const end = minutesOfDay(quietHours.end);
  if (start === null || end === null || start === end) return false;
  let cur;
  try {
    cur = localMinutes(quietHours.tz || DEFAULT_TZ, now);
  } catch (_) {
    return false; // unknown tz string — fail open
  }
  return start < end
    ? (cur >= start && cur < end)          // same-day window
    : (cur >= start || cur < end);         // overnight window
};

const buildMessage = (eventType, payload, tenant) => {
  const {
    contactName, phone, score, reason, question,
    problemSummary, nextAction, urgencyTrigger, conversationUrl,
  } = payload || {};
  const name = contactName || phone || 'Unknown';
  const brand = tenant.name || 'ASOS';

  switch (eventType) {
    case 'newLead':
      return `🆕 *New Lead — ${brand}*\n\nContact: ${name}\nPhone: +${phone}\n\nAI is now handling the conversation.`;

    case 'hotLead': {
      // The briefing-pack alert: enough context to make the call without
      // opening the dashboard first. Every field is optional — the Qualifier
      // doesn't always produce all of them.
      const lines = [`🔥 *HOT Lead Alert — ${brand}*`, '', `Contact: ${name}`, `Phone: +${phone}`, `Score: ${score}/10`];
      if (problemSummary) lines.push(`Problem: ${problemSummary}`);
      if (urgencyTrigger) lines.push(`Urgency: ${urgencyTrigger}`);
      if (nextAction) lines.push('', `Suggested next step: ${nextAction}`);
      lines.push('', conversationUrl
        ? `Open the thread: ${conversationUrl}`
        : 'This lead is ready to close. Consider reaching out directly.');
      return lines.join('\n');
    }

    case 'needsHuman':
      return `🙋 *Human Handoff — ${brand}*\n\nContact: ${name}\nPhone: +${phone}\nReason: ${reason || 'AI escalated'}\n\nPlease take over this conversation.`;

    case 'unansweredQuestion':
      // AI is still handling this lead — this is a heads-up, not a handoff.
      return `❓ *Knowledge Gap — ${brand}*\n\nContact: ${name}\nPhone: +${phone}\nQuestion: ${question || 'unspecified'}\n\nThe AI didn't have this in its knowledge base — worth adding an answer.`;

    default:
      return `📢 *${brand} Alert*\n\nContact: ${name} (+${phone})`;
  }
};

const EMAIL_SUBJECTS = {
  hotLead: (p) => `🔥 Hot lead: ${p.contactName || p.phone || 'Unknown'}`,
  needsHuman: (p) => `🙋 Handoff needed: ${p.contactName || p.phone || 'Unknown'}`,
};

/**
 * Send an alert to the tenant admin for a key lead event.
 * WhatsApp when adminPhone + the event's whatsapp pref allow it (and quiet
 * hours don't apply); email fallback (settings.alertEmail) for hotLead /
 * needsHuman whenever the WhatsApp copy did not go out.
 *
 * @param {object} tenant        - Full tenant object (with settings JSON)
 * @param {'newLead'|'hotLead'|'needsHuman'|'unansweredQuestion'} eventType
 * @param {object} payload       - { contactName, phone, score, reason, question,
 *                                   problemSummary, nextAction, urgencyTrigger,
 *                                   conversationUrl }
 */
const notifyAdmin = async (tenant, eventType, payload = {}) => {
  try {
    const settings = tenant.settings || {};
    const adminPhone = settings.adminPhone;
    const prefs = settings.notifPrefs || {};
    const pref = prefs[eventType] || {};

    const msg = buildMessage(eventType, payload, tenant);
    let waDelivered = false;

    if (adminPhone && pref.whatsapp) {
      if (!URGENT_EVENTS.has(eventType) && inQuietHours(settings.quietHours)) {
        logger.info({ tenantId: tenant.id, eventType }, '🔕 Admin WA notification suppressed — quiet hours');
      } else {
        try {
          await whatsappService.sendText(tenant, adminPhone, msg);
          waDelivered = true;
          logger.info({ tenantId: tenant.id, eventType, adminPhone }, '🔔 Admin WA notification sent');
        } catch (err) {
          // Most common cause: the admin's own number is outside Meta's 24h
          // customer-service window (error 131047). The email fallback below
          // is what keeps the alert from vanishing.
          logger.warn({ err, tenantId: tenant.id, eventType }, 'Admin WA notification failed');
        }
      }
    }

    if (!waDelivered
      && EMAIL_FALLBACK_EVENTS.has(eventType)
      && settings.alertEmail
      && emailService.isAlertEmailConfigured()) {
      try {
        await emailService.sendAlertEmail({
          to: settings.alertEmail,
          brandName: tenant.name || 'ASOS',
          subject: EMAIL_SUBJECTS[eventType](payload),
          // The WhatsApp body reads fine as plain-text email lines; strip the
          // *bold* markers WhatsApp uses.
          lines: msg.replaceAll('*', '').split('\n').filter(Boolean),
          ctaUrl: payload.conversationUrl || null,
          ctaLabel: 'Open the conversation',
        });
        logger.info({ tenantId: tenant.id, eventType }, '📧 Admin email alert sent (WA fallback)');
      } catch (err) {
        logger.warn({ err, tenantId: tenant.id, eventType }, 'Admin email alert failed');
      }
    }
  } catch (err) {
    // Non-fatal — never block the main pipeline
    logger.warn({ err, tenantId: tenant.id, eventType }, 'Admin notification failed');
  }
};

module.exports = { notifyAdmin, buildMessage, inQuietHours, minutesOfDay };
