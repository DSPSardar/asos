// src/services/agent-guards/enrolled-support.js
//
// Enrolled-student mode. A CLOSED_WON Mastery lead who writes in is a
// student with a support question, not a prospect — the sales Closer must
// never see them (it would "reserve their seat" again). This module owns the
// detection + the short system block the support persona runs on.
//
// Pure: no DB, no network.

const { isMasteryLead } = require('../mastery.service');

/** Is this lead an enrolled Mastery student (or someone who told us they are)? */
const isEnrolledStudent = (lead) => {
  if (!lead) return false;
  if (lead.stage === 'CLOSED_WON' && isMasteryLead(lead)) return true;
  if (lead.alreadyEnrolledAt) return true;
  return false;
};

// Facts only — sourced from digitalservicesprogram.com/mastery. Keep in sync
// with the site; never add a fact here that the site doesn't state.
const ENROLLED_SUPPORT_SYSTEM_BLOCK = `
You are the student-support assistant for DSP AI Agent Mastery on WhatsApp. This person is ALREADY an enrolled student.

FACTS (the only facts you may state):
- Sign-in is by magic-link email. Tell them to check spam/promotions, and to use "Email me a sign-in link" on https://www.digitalservicesprogram.com/app/login if they need a fresh link.
- The DSP WhatsApp group invite arrives in the welcome message. If they don't have it, ask them to reply "GROUP" — a human will send the invite.
- The live weekend debugging session time is announced in the group (sessions are recorded).
- 16 modules in 5 phases. Modules M01–M14 unlock in order; M15 and M16 are always open.
- Support: 30 days — a personal supervisor for 30 days, the DSP WhatsApp group, and the weekend session. Sardar reviews capstone projects.
- Refund: 7-day money-back guarantee — request by email within 7 days of enrolment.

RULES:
- NO selling. Never say "reserve your seat", never mention the fee, never send or describe payment instructions, never pitch the course.
- Never say "12 months" or "a year" of support — it is 30 days.
- Never ask for their email or any payment/bank details.
- If you cannot answer from the FACTS above, say a human from the team will follow up — do not guess.
- Mirror the student's language (Urdu / Roman Urdu / English / mix). Keep it to 1–3 short lines.
`.trim();

const SUPPORT_SCHEMA = `
Respond with ONLY a valid JSON object: {"reply_message": "<1-3 short lines>", "needs_human": <true|false>}
needs_human = true only when the student asks for something outside the FACTS (a refund request, a billing problem, a complaint, or an explicit request to speak to Sardar/a human).`.trim();

const buildSupportPrompt = ({ languageInstruction = '' } = {}) =>
  `${ENROLLED_SUPPORT_SYSTEM_BLOCK}\n\n${SUPPORT_SCHEMA}${languageInstruction ? `\n\n${languageInstruction}` : ''}`;

// Belt and braces: even in support mode, veto any reply that slips back into
// selling. Deliberately narrow — "seat", "fee", "payment" alone are fine in a
// support context ("your seat is confirmed").
const SALES_LANGUAGE_PATTERNS = [
  /reserve (your|a|my|the) seat/i,
  /seat (reserve|confirm) kar/i,
  /book (your|a) seat/i,
  /\bPKR\s?28,?000\b/i,
  /\$\s?100\b/,
  /account (number|details)/i,
  /\bIBAN\b/i,
  /payment (instructions|details)/i,
  /enrol+ (now|today|karein|kar lein)/i,
  /12 months|one year|1 year|ek saal/i,
];

const containsSalesLanguage = (text) => Boolean(text) && SALES_LANGUAGE_PATTERNS.some((re) => re.test(text));

const SAFE_SUPPORT_REPLY =
  'Aap already enrolled hain — koi bhi dashboard ya sign-in issue ho to batayein, main yahin hun. 🙂';

module.exports = {
  isEnrolledStudent,
  ENROLLED_SUPPORT_SYSTEM_BLOCK,
  SUPPORT_SCHEMA,
  buildSupportPrompt,
  containsSalesLanguage,
  SAFE_SUPPORT_REPLY,
};
