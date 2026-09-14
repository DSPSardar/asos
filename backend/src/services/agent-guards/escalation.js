// src/services/agent-guards/escalation.js
//
// Hard escalation rules — independent of the dashboard handoff toggles. The
// DSP tenant runs fully automatic, so these are the ONLY things that pull a
// human in mid-conversation:
//   • refund DEMAND / dispute / chargeback (a refund-policy question does not)
//   • complaint / legal / FBR / fraud
//   • an explicit request for a human or for Sardar
//   • two consecutive negative-sentiment messages
// Fee / payment / screenshot / "paid" / "transaction" NEVER escalate on their
// own — they are the normal enrolment flow.
//
// Also home to two small detectors the worker needs for the suppression lists:
// "already enrolled" and opt-out.
//
// Pure: no DB, no network.

// Refund — split into INQUIRY vs DEMAND. Asking about the refund policy is a
// normal pre-sale question ("Refund policy", "Refund is on website", "kya
// refund milta hai") and must never escalate: a false escalation flips
// ai_enabled off and the lead never hears back, while a missed one costs a
// single digest line. So the inquiry pattern is checked FIRST and wins
// wherever both could match; a refund only escalates when it sits next to a
// demand marker (verb / "karo" / "chahiye" / "now") or a possessive ("my
// refund", "mujhe refund" — you only own a refund after you have paid).
const R = String.raw;
// A refund token followed by a possessive is a demand, not an inquiry
// ("can you refund my money" vs "can you refund").
const REFUND_NOT_MINE = R`(?!\s+(my|me|mera|mere|meri|mujhe|muje|mujhy|the\s+(money|amount|fee|payment))\b)`;
const REFUND_INQUIRY_PATTERN = new RegExp([
  // "refund policy", "refund process", "refund available?", "refund milta hai", "refund kaise hota hai"
  R`\brefunds?[\s-]*(policy|policies|rules?|terms?|conditions?|process|procedure|guarantee|options?|kya|kia|kaise|kese|kab|kb|kitna|kitne|kitni|hai|hain|hoga|hogi|hota|hoti|mil\w*|available|possible|mumkin)\b`,
  R`\brefunds?\s*\?`,
  // "refund is on website", "refund is mentioned in terms"
  R`\brefunds?\s+(is|are)\s+(on|in|at|available|mentioned|there|possible|listed|written|not\s+available)\b`,
  // "refund ke baray mein", "refund ki policy"
  R`\brefunds?\s+k[ie]\s+(bar[ae]y?|baar[ae]y?|policy|tareeq\w*)`,
  // "is there a refund", "is refund possible"
  R`\b(is|are)\s+(there\s+)?(a\s+|any\s+|the\s+)?refunds?\b` + REFUND_NOT_MINE,
  // "what is your refund policy", "what about refund"
  R`\bwhat(?:'s|s|\s+is|\s+are|\s+about)?\s+(?:the\s+|your\s+|ur\s+|a\s+|any\s+)?refunds?\b` + REFUND_NOT_MINE,
  // "how can I get a refund", "how does refund work", "how to refund"
  R`\bhow\s+(do|does|can|could|will|would|to|about|much|is|are)\b(?:(?!\b(my|mera|mere|meri|mujhe|muje|mujhy)\b).){0,12}\brefunds?\b` + REFUND_NOT_MINE,
  // "can I get a refund", "do you give refund" — only function words may sit between,
  // so "how dare you, refund karo" / "kya bakwas hai, refund karo" fall through to DEMAND
  R`\b(can|could|do|does|will|would|should)\s+(?:(?:i|we|you|u|they|one|someone|students?|a|an|the|this|it|that|course|get|have|offer|give|provide|ask|for|claim|request|any|some|also|even|full|partial|be|there)\s+){0,5}refunds?\b` + REFUND_NOT_MINE,
  // "kya refund milta hai", "kya aap refund dete hain", "agar refund ..."
  R`\b(kya|kia|kiya|agar)\s+(?:(?:aap|ap|tum|app|koi|is|iss|us|course|ka|ki|ke|k|me|mein|main|py|pe|par|pr|se|ye|yeh|hum|bhi)\s+){0,4}refunds?\b` + REFUND_NOT_MINE,
  // "policy ... refund", "money back guarantee ya refund"
  R`\b(policy|policies|guarantee)\b.{0,20}\brefunds?\b`,
].join('|'), 'i');

// Refund DEMAND / dispute / chargeback — English + Roman Urdu + Urdu script.
// "payment failed" on its own is NOT here: a failed transfer is a support
// question, not a dispute. "charged me twice/again/wrongly" is. A bare
// "refund" is deliberately NOT here any more — see REFUND_INQUIRY_PATTERN.
const REFUND_DISPUTE_PATTERN = new RegExp([
  // demand verb before the refund token: "I want a refund", "give me a refund", "process my refund"
  R`\b(want|wants|wanted|need|needs|demand\w*|give|gimme|return|send|process|issue|expect|claim|get|getting)\b.{0,20}\brefunds?\b`,
  // demand marker after it: "refund karo", "refund chahiye", "refund now", "refund nahi mila"
  R`\brefunds?\b.{0,20}\b(now|abhi|immediately|asap|today|karo|kro|kar\s?do|kardo|krdo|kar\s?dein|kardein|dein|dijiye|den|do|chahiye|chahiy|chaiye|chahye|chaye|chahta|chahti|mangta|mangti|mang\s?rah\w*|please|plz|nahi\s+(mila|aya|aaya|hua)|not\s+(received|done|processed))\b`,
  // possessive = already paid: "where is my refund", "mujhe refund", "refund my money", "refund me"
  R`\b(mujhe|muje|mujhy|mera|mere|meri|my)\s+refunds?\b`,
  R`\brefunds?\s+(me|my|mujhe|muje|mujhy|mera|mere|meri|it|the\s+(money|amount|fee|payment))\b`,
  // dispute / chargeback / wrong charge — unchanged
  R`dispute|charge ?back|charged\s+(me|twice|double|again|wrong)|double\s+charge|paisay wapis|paise wapas|paisay wapas|paise wapis|wapis karo|wapas karo|galat charge|dhoka|fraud hua|رقم واپس|ریفنڈ|پیسے واپس`,
].join('|'), 'i');

// Complaint / legal / FBR / fraud
const COMPLAINT_LEGAL_PATTERN = /lawyer|vakeel|legal action|legal notice|sue you|court|adalat|consumer (complaint|court)|complaint|shikayat|\bFBR\b|fraud|scam|fake|police|\bFIR\b|cyber ?crime|وکیل|عدالت|شکایت|فراڈ|دھوکہ/i;

// Explicit request for a human or for Sardar
const HUMAN_REQUEST_PATTERN = /\b(talk|speak|chat|baat|bat)\b.{0,25}\b(human|person|insaan|insan|banda|bande|admi|aadmi|agent|someone real|real person|sardar|sir sardar|owner|manager)\b|\b(sardar|human|insaan|insan|real person|koi banda|kisi bande|agent)\b.{0,25}\b(se baat|se bat|ko bulao|chahiye|chahiy|please|plz|number)\b|\bsardar (sir|sahab|bhai|se)\b|\bis this a bot\b.{0,20}\b(human|person)\b|\bno bot\b|\bnot a bot\b.{0,10}\bplease\b|سردار سے|انسان سے بات|بندے سے بات/i;

// Inquiry is checked first and short-circuits: where both could match, inquiry wins.
const detectRefundDispute = (m) => {
  const text = String(m || '');
  if (REFUND_INQUIRY_PATTERN.test(text)) return false;
  return REFUND_DISPUTE_PATTERN.test(text);
};
const detectComplaintOrLegal = (m) => COMPLAINT_LEGAL_PATTERN.test(String(m || ''));
const detectHumanRequest = (m) => HUMAN_REQUEST_PATTERN.test(String(m || ''));

/**
 * Keyword-based hard escalation on the message text alone.
 * @returns {{ escalate: boolean, reason: string|null, kind: string|null }}
 */
const detectHardEscalation = (message) => {
  if (detectRefundDispute(message))    return { escalate: true, kind: 'refund_dispute',   reason: 'Refund / dispute / chargeback request — human required' };
  if (detectComplaintOrLegal(message)) return { escalate: true, kind: 'complaint_legal',  reason: 'Complaint / legal / fraud keywords — human required' };
  if (detectHumanRequest(message))     return { escalate: true, kind: 'human_requested',  reason: 'Lead asked to speak to a human / Sardar' };
  return { escalate: false, kind: null, reason: null };
};

/** Two consecutive NEGATIVE inbound messages (previous stored + current Qualifier output). */
const isConsecutiveNegative = (previousSentiment, currentSentiment) =>
  previousSentiment === 'NEGATIVE' && currentSentiment === 'NEGATIVE';

// Sardar's personal WhatsApp — given ONLY when a lead asks for a human/Sardar.
const SARDAR_WHATSAPP = '+92 311 8122222';
const HUMAN_REQUEST_REPLY =
  `Bilkul — aap Sardar sir se seedha WhatsApp par baat kar sakte hain: ${SARDAR_WHATSAPP}. ` +
  'Hamari team bhi jald aap se rabta karegi. 🙏';

// ── "already enrolled" ────────────────────────────────────────────────
const ALREADY_ENROLLED_PATTERN = /\b(already|pehle se|pehly se|pehlay se|phle se)\b.{0,25}\b(enrol+ed|enrol+ment|registered|student|member|join(ed)?|paid|kar (chuka|chuki|liya)|kr (chuka|chuki|liya)|ho (chuka|chuki|gaya))\b|\bmain (to )?(pehle se|already) (student|enrol+ed|member) h(u|o)n?\b|\bi am (already )?(a )?(student|enrol+ed)\b|پہلے سے (داخلہ|رجسٹر|انرول)/i;
const detectAlreadyEnrolled = (m) => ALREADY_ENROLLED_PATTERN.test(String(m || ''));

// ── Opt-out ───────────────────────────────────────────────────────────
// Bare "stop" / "unsubscribe" must be the whole message ("stop kab hoga
// course?" is a question, not an opt-out); the longer phrases can lead in.
const OPT_OUT_PATTERN = /^\s*(please |plz |bhai |sir )?((stop|unsubscribe|stop messaging( me)?|remove me|leave me alone)\s*[^\w\s]*\s*$|(band karo|bnd karo|dont message|don't message|do not message|(mujhe |muje |mujhy )?(message|msg|messages) (mat|na) (karo|karein|karain|bhejo|bhejein|karna|krna)|مجھے میسج نہ کریں|بند کرو)\b)/i;
const detectOptOut = (m) => OPT_OUT_PATTERN.test(String(m || ''));

const OPT_OUT_REPLY = 'Theek hai — hum aap ko mazeed messages nahi bhejenge. Kabhi zaroorat ho to yahin likh dijiyega. 🙏';

module.exports = {
  REFUND_INQUIRY_PATTERN, REFUND_DISPUTE_PATTERN, COMPLAINT_LEGAL_PATTERN, HUMAN_REQUEST_PATTERN,
  detectRefundDispute, detectComplaintOrLegal, detectHumanRequest,
  detectHardEscalation, isConsecutiveNegative,
  SARDAR_WHATSAPP, HUMAN_REQUEST_REPLY,
  detectAlreadyEnrolled, detectOptOut, OPT_OUT_REPLY,
};
