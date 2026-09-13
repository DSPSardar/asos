// src/services/agent-guards/form-submitted.js
//
// "Already filled the form" backstop. After payment the lead gets the
// enrolment-form link; when they come back saying they submitted it, the
// right answer is fixed (registration is in process, sign-in details follow
// by email + WhatsApp) — not another Closer turn that tries to sell, and not
// an "Unpaid Enrollment Reminder" three days later.
//
// Pure: no DB, no network.

// Urdu / Roman Urdu / English. Deliberately requires a "form / register /
// submit / done" signal, so "payment kar diya" (a payment claim, handled by the
// proof flow) does not match.
const FORM_SUBMITTED_PATTERNS = [
  /\bform\b.{0,30}\b(fill|filled|bhar|bhr|submit|submitted|kar (diya|dia|di|dya)|kr (diya|dia|di|dya)|complete|done|ho gaya|hogaya|ho gya)\b/i,
  /\b(fill|filled|submit|submitted|bhar|bhr)\w*\b.{0,20}\bform\b/i,
  /\b(register|registered|registration|enrol+ed|enrol+ment)\b.{0,25}\b(done|kar (diya|dia|di|dya)|kr (diya|dia|di|dya)|ho gaya|hogaya|ho gya|complete|completed|submitted)\b/i,
  /\b(done|complete|completed)\b.{0,25}\b(registration|register|enrol+ment|form)\b/i,
  /\bform (bhej|send|submit) (diya|dia|di|kar diya|kr diya)\b/i,
  // Bare one-word confirmations — only meaningful because the caller gates
  // this on the lead being payment-pending / holding the form link.
  /^\s*(submitted|registered|done|form done|form submitted|ho gaya|hogaya|ho gya|kar diya|kr diya|kar dia|kr dia)\s*[^\w\s]*\s*$/i,
  /\b(i have|i've|ive|i)\s+(registered|submitted|filled( it| the form)?|completed (it|the form|registration))\b/i,
  /\b(maine|main ne|mene|mai ne)\s+(register|submit|fill|form)\w*\s+(kar|kr)\s*(diya|dia|di|liya|lia)\b/i,
  /فارم.{0,20}(بھر|جمع)/,           // Urdu script: form bhar/jama
  /رجسٹر.{0,20}(کر|ہو)/,            // Urdu script: register kar/ho
];

const detectFormSubmitted = (message) => {
  const text = String(message || '').trim();
  if (!text) return false;
  return FORM_SUBMITTED_PATTERNS.some((re) => re.test(text));
};

// The lead is "payment-pending" when they are at PROPOSED or we have already
// sent them the bank details / received a screenshot.
const isPaymentPending = ({ lead, conversation }) => {
  if (!lead) return false;
  if (['CLOSED_WON', 'CLOSED_LOST'].includes(lead.stage)) return false;
  if (lead.stage === 'PROPOSED') return true;
  if (conversation?.paymentDetailsSentAt || conversation?.paymentProofDetected) return true;
  return false;
};

const FORM_SUBMITTED_REPLY =
  'Shukriya! 🙏 Aap ki registration process mein hai. Aap ko jald hi email aur WhatsApp par sign-in details mil jayengi. ' +
  'Thank you — your registration is in process; you will receive an email and a WhatsApp message soon with your sign-in details.';

module.exports = { detectFormSubmitted, isPaymentPending, FORM_SUBMITTED_REPLY, FORM_SUBMITTED_PATTERNS };
