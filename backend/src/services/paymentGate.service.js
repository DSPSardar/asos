// src/services/paymentGate.service.js
//
// The "payment screenshot → login link" gap.
//
// Won means paid, so a screenshot parks the conversation in
// PENDING_VERIFICATION with AI off until a human confirms it. Correct — but
// as shipped, everything after the ack was silence:
//
//   • the student writes "done?", "kab milega?", "link?" → AI disabled →
//     "delivered to agent inbox only" → nothing goes back;
//   • the human confirms → the course emails a sign-in link → the WhatsApp
//     thread, where the whole sale happened, never says "you're in";
//   • the contact has no email (Zara is told to collect it, but often
//     doesn't) → the enrol call no-ops into an Activity row and the student
//     is paid, silent, and locked out until someone notices.
//
// This module fills every one of those holes without touching the gate
// itself. Nothing here books revenue, nothing here enrols an unverified
// payment. It only talks to the student while they wait, captures the email
// the enrolment needs, and hands the login over the moment the human says yes.

const prisma = require('../config/database');
const redis = require('../config/redis');
const env = require('../config/env');
const logger = require('../utils/logger');
const { sendAndSaveReply } = require('./outbound.service');

// One holding reply per conversation per window — a student who sends five
// "??" in a row should not get five "we're verifying" back.
const HOLD_WINDOW_SEC = 6 * 60 * 60;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** First email-looking token in a text, lowercased; null if none. */
const extractEmail = (text) => {
  const m = String(text || '').match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
};

const isMastery = (lead) => String(lead?.product || '').toUpperCase() === 'MASTERY';

const cfg = (tenant, key, fallback) => {
  const v = tenant?.settings?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
};

// ── Message copy (per-tenant override via tenant.settings.<key>) ─────────
const DEFAULTS = {
  // Appended to the screenshot ack when the contact has no email yet.
  askEmailAfterProof:
    "📧 One thing so your account is ready the moment it's verified: reply with the email address you'd like to use for your AI Agent Mastery login.",
  // Sent (rate-limited) when the student writes while verification is pending.
  pendingHold:
    "Thanks for your patience 🙏 Your payment proof is with our team for verification — usually within a few hours during working hours. As soon as it's confirmed you'll get your AI Agent Mastery login right here on WhatsApp and by email.",
  // Reply when the student sends an email while pending.
  emailCaptured:
    '✅ Got it — your AI Agent Mastery account will be created on {email} as soon as the payment is verified.',
  // Sent by the enrol path once the course account exists.
  loginWelcome:
    '🎉 Payment verified — welcome to AI Agent Mastery!\n\nYour account is on {email}.\nSign in here: {loginUrl}\n\nA set-up email with your password has been sent to {email} (check spam if you don\'t see it). Reply here if anything doesn\'t work.',
  // Sent by the enrol path when the payment is verified but no email is on file.
  loginNeedsEmail:
    '✅ Your payment has been verified — thank you!\n\nTo create your AI Agent Mastery account, please reply with the email address you\'d like to use. Your login link goes out the moment we have it.',
};

const send = async ({ tenant, tenantId, conversationId, phone, content, tag }) => {
  const r = await sendAndSaveReply({
    tenant, tenantId, phone, content,
    conversation: { id: conversationId },
    tokensUsed: 0,
    rawResponse: { systemMessage: tag },
    voiceNote: false,
  });
  return r?.sent === true;
};

const saveEmail = async ({ tenantId, contactId, leadId, email, userId = null }) => {
  await prisma.contact.update({ where: { id: contactId }, data: { email } });
  await prisma.activity.create({ data: {
    tenantId, leadId, userId, type: 'SYSTEM',
    content: `📧 Email captured on WhatsApp: ${email}`,
    metadata: { flag: 'email_captured', email },
  } }).catch(() => {});
};

/**
 * Text to append to the payment-proof ack: asks for the email up front when
 * a Mastery lead has none, so verification and enrolment don't stall twice.
 */
const emailRequestForAck = ({ tenant, lead, contact }) => {
  if (!isMastery(lead)) return '';
  if ((contact?.email || '').trim()) return '';
  return '\n\n' + cfg(tenant, 'paymentAskEmailMessage', DEFAULTS.askEmailAfterProof);
};

/**
 * Called by the worker for an inbound message on a conversation whose AI is
 * off. Handles the two gated states this module owns and returns true when
 * it replied (or deliberately chose not to); false means "not mine — carry
 * on with the existing agent-inbox behaviour".
 */
const handleInboundWhileGated = async ({ tenant, tenantId, conversation, lead, contact, content, phone }) => {
  const stage = lead?.stage;
  const pending = !!conversation.paymentProofDetected && stage !== 'CLOSED_WON' && stage !== 'CLOSED_LOST';
  const wonNoEmail = stage === 'CLOSED_WON' && isMastery(lead) && !(contact?.email || '').trim();
  if (!pending && !wonNoEmail) return false;

  const base = { tenant, tenantId, conversationId: conversation.id, phone };
  const email = extractEmail(content);

  // ── Email arrives while we wait / after the win ─────────────────────
  if (email && !(contact?.email || '').trim()) {
    await saveEmail({ tenantId, contactId: contact.id, leadId: lead.id, email });

    if (wonNoEmail) {
      // Payment is already verified: finish the enrolment now, no re-confirm.
      // Lazy require — mastery.service imports this module for the welcome.
      const masteryService = require('./mastery.service');
      const r = await masteryService.enrolIfMastery({ tenantId, leadId: lead.id });
      logger.info({ conversationId: conversation.id, result: r }, '🎓 Post-win email captured — enrolment attempted');
      return true; // enrolIfMastery sends the login (or the failure is logged as an Activity)
    }

    await send({ ...base, tag: 'payment_gate_email_captured',
      content: cfg(tenant, 'paymentEmailCapturedMessage', DEFAULTS.emailCaptured).replace('{email}', email) });
    return true;
  }

  if (!pending) return false;

  // ── Anything else while pending: one holding reply per window ────────
  const key = `asos:payment_hold:${conversation.id}`;
  const first = await redis.set(key, '1', 'EX', HOLD_WINDOW_SEC, 'NX').catch(() => null);
  if (first !== 'OK') {
    logger.info({ conversationId: conversation.id }, '⏳ Pending-verification hold already sent this window — inbox only');
    return true;
  }

  let text = cfg(tenant, 'paymentPendingMessage', DEFAULTS.pendingHold);
  if (isMastery(lead) && !(contact?.email || '').trim()) {
    text += '\n\n' + cfg(tenant, 'paymentAskEmailMessage', DEFAULTS.askEmailAfterProof);
  }
  await send({ ...base, tag: 'payment_gate_hold', content: text });
  await prisma.activity.create({ data: {
    tenantId, leadId: lead.id, type: 'AI_ACTION',
    content: '⏳ Student wrote while payment verification is pending — holding reply sent',
    metadata: { flag: 'payment_pending_hold' },
  } }).catch(() => {});
  logger.info({ conversationId: conversation.id }, '⏳ Pending-verification holding reply sent');
  return true;
};

/** Latest conversation for a lead (the enrol path is called without one). */
const conversationForLead = (tenantId, leadId) =>
  prisma.conversation.findFirst({ where: { tenantId, leadId }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } });

/** After the course account exists: hand the login over on WhatsApp. */
const sendLoginWelcome = async ({ tenantId, leadId, email }) => {
  const [tenant, lead, conv] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { contact: { select: { phone: true } } } }),
    conversationForLead(tenantId, leadId),
  ]);
  if (!tenant || !lead?.contact?.phone || !conv) return false;
  const content = cfg(tenant, 'masteryLoginMessage', DEFAULTS.loginWelcome)
    .replaceAll('{email}', email)
    .replaceAll('{loginUrl}', env.MASTERY_LOGIN_URL);
  return send({ tenant, tenantId, conversationId: conv.id, phone: lead.contact.phone, content, tag: 'mastery_login_sent' });
};

/** Payment verified but no email: ask on WhatsApp (once per 24h). */
const askEmailAfterWin = async ({ tenantId, leadId }) => {
  const [tenant, lead, conv] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { contact: { select: { phone: true } } } }),
    conversationForLead(tenantId, leadId),
  ]);
  if (!tenant || !lead?.contact?.phone || !conv) return false;
  const first = await redis.set(`asos:won_ask_email:${leadId}`, '1', 'EX', 24 * 3600, 'NX').catch(() => 'OK');
  if (first !== 'OK') return false;
  return send({ tenant, tenantId, conversationId: conv.id, phone: lead.contact.phone,
    content: cfg(tenant, 'masteryNeedsEmailMessage', DEFAULTS.loginNeedsEmail), tag: 'mastery_login_needs_email' });
};

module.exports = {
  extractEmail, emailRequestForAck, handleInboundWhileGated, sendLoginWelcome, askEmailAfterWin, DEFAULTS, HOLD_WINDOW_SEC,
};
