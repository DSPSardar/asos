// src/services/notification.service.js
// Handles WhatsApp admin alerts for key lead events.
// Notification prefs live in tenant.settings.notifPrefs (JSON).
// Admin phone lives in tenant.settings.adminPhone.

const whatsappService = require('./whatsapp.service');
const logger = require('../utils/logger');

/**
 * Send a WhatsApp message to the admin phone if their notification
 * preferences allow it for the given event type.
 *
 * @param {object} tenant        - Full tenant object (with settings JSON)
 * @param {'newLead'|'hotLead'|'needsHuman'|'unansweredQuestion'} eventType
 * @param {object} payload       - { contactName, phone, score, reason, question }
 */
const notifyAdmin = async (tenant, eventType, payload = {}) => {
  try {
    const settings   = tenant.settings || {};
    const adminPhone = settings.adminPhone;
    const prefs      = settings.notifPrefs || {};
    const pref       = prefs[eventType] || {};

    if (!adminPhone || !pref.whatsapp) return;

    const msg = buildMessage(eventType, payload, tenant);
    await whatsappService.sendText(tenant, adminPhone, msg);
    logger.info({ tenantId: tenant.id, eventType, adminPhone }, '🔔 Admin WA notification sent');
  } catch (err) {
    // Non-fatal — never block the main pipeline
    logger.warn({ err, tenantId: tenant.id, eventType }, 'Admin WA notification failed');
  }
};

const buildMessage = (eventType, { contactName, phone, score, reason, question }, tenant) => {
  const name  = contactName || phone || 'Unknown';
  const brand = tenant.name || 'ASOS';

  switch (eventType) {
    case 'newLead':
      return `🆕 *New Lead — ${brand}*\n\nContact: ${name}\nPhone: +${phone}\n\nAI is now handling the conversation.`;

    case 'hotLead':
      return `🔥 *HOT Lead Alert — ${brand}*\n\nContact: ${name}\nPhone: +${phone}\nScore: ${score}/10\n\nThis lead is ready to close. Consider reaching out directly.`;

    case 'needsHuman':
      return `🙋 *Human Handoff — ${brand}*\n\nContact: ${name}\nPhone: +${phone}\nReason: ${reason || 'AI escalated'}\n\nPlease take over this conversation.`;

    case 'unansweredQuestion':
      // AI is still handling this lead — this is a heads-up, not a handoff.
      return `❓ *Knowledge Gap — ${brand}*\n\nContact: ${name}\nPhone: +${phone}\nQuestion: ${question || 'unspecified'}\n\nThe AI didn't have this in its knowledge base — worth adding an answer.`;

    default:
      return `📢 *${brand} Alert*\n\nContact: ${name} (+${phone})`;
  }
};

module.exports = { notifyAdmin };
