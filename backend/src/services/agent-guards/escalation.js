// src/services/agent-guards/escalation.js
//
// Hard escalation rules — independent of the dashboard handoff toggles. The
// DSP tenant runs fully automatic, so these are the ONLY things that pull a
// human in mid-conversation:
//   • refund / dispute / chargeback
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

// Refund / dispute / chargeback — English + Roman Urdu + Urdu script.
// "payment failed" on its own is NOT here: a failed transfer is a support
// question, not a dispute. "charged me twice/again/wrongly" is.
const REFUND_DISPUTE_PATTERN = /refund|dispute|charge ?back|charged\s+(me|twice|double|again|wrong)|double\s+charge|paisay wapis|paise wapas|paisay wapas|paise wapis|wapis karo|wapas karo|galat charge|dhoka|fraud hua|رقم واپس|ریفنڈ|پیسے واپس/i;

// Complaint / legal / FBR / fraud
const COMPLAINT_LEGAL_PATTERN = /lawyer|vakeel|legal action|legal notice|sue you|court|adalat|consumer (complaint|court)|complaint|shikayat|\bFBR\b|fraud|scam|fake|police|\bFIR\b|cyber ?crime|وکیل|عدالت|شکایت|فراڈ|دھوکہ/i;

// Explicit request for a human or for Sardar
const HUMAN_REQUEST_PATTERN = /\b(talk|speak|chat|baat|bat)\b.{0,25}\b(human|person|insaan|insan|banda|bande|admi|aadmi|agent|someone real|real person|sardar|sir sardar|owner|manager)\b|\b(sardar|human|insaan|insan|real person|koi banda|kisi bande|agent)\b.{0,25}\b(se baat|se bat|ko bulao|chahiye|chahiy|please|plz|number)\b|\bsardar (sir|sahab|bhai|se)\b|\bis this a bot\b.{0,20}\b(human|person)\b|\bno bot\b|\bnot a bot\b.{0,10}\bplease\b|سردار سے|انسان سے بات|بندے سے بات/i;

const detectRefundDispute = (m) => REFUND_DISPUTE_PATTERN.test(String(m || ''));
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
  REFUND_DISPUTE_PATTERN, COMPLAINT_LEGAL_PATTERN, HUMAN_REQUEST_PATTERN,
  detectRefundDispute, detectComplaintOrLegal, detectHumanRequest,
  detectHardEscalation, isConsecutiveNegative,
  SARDAR_WHATSAPP, HUMAN_REQUEST_REPLY,
  detectAlreadyEnrolled, detectOptOut, OPT_OUT_REPLY,
};
