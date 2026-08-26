// src/services/claude.service.js
// ASOS v1.5 — Dual AI Agent System
//
//   Qualifier AI  →  analyzes message, scores lead, classifies intent
//   Closer AI     →  generates persuasive WhatsApp reply
//
// Both agents return strict JSON. Sequential pipeline, modular by design.
// processMessage() is kept as a thin wrapper so the worker / existing API
// surface is unchanged.

const OpenAI = require('openai');
const env = require('../config/env');
const logger = require('../utils/logger');
const prisma = require('../config/database');
const kgSvc = require('../modules/knowledge-gaps/knowledge-gaps.service');

// Bounded on purpose. The SDK defaults to a 10-minute timeout with 2 automatic
// retries, so a single stalled call could pin a worker job for ~30 minutes —
// long past the per-conversation lock's TTL, which is exactly how two messages
// from the same lead end up being answered concurrently with the same reply.
const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: 60_000,
  maxRetries: 1,
});

// ── Model selection (per-agent) ───────────────────────────────────────
// Qualifier = fast/cheap (analytic). Closer = better copy.
const QUALIFIER_MODEL = env.OPENAI_QUALIFIER_MODEL || env.OPENAI_MODEL;
const CLOSER_MODEL    = env.OPENAI_CLOSER_MODEL || env.OPENAI_MODEL;

const createResponse = async ({ model, maxOutputTokens, instructions, input, jsonMode = false }) => {
  const messages = [
    { role: 'system', content: instructions },
    ...(input || []),
  ];

  return client.chat.completions.create({
    model,
    messages,
    max_completion_tokens: maxOutputTokens,
    // Qualifier/Closer prompts demand strict JSON, but the model isn't
    // always compliant on its own — it occasionally answers in plain
    // prose instead, which fails JSON.parse() downstream and falls back
    // to a hardcoded generic reply (the "same answer every time" bug).
    // response_format forces the API to guarantee syntactically valid
    // JSON output, closing that failure mode at the source instead of
    // parsing around it. generateSummary() wants plain text, so this is
    // opt-in per call site, not global.
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  });
};

// =====================================================================
// QUALIFIER AI
// =====================================================================

// The only values downstream code (deriveStage, the worker's action switch)
// understands. Kept in sync with the schema text below.
const NEXT_ACTIONS = ['continue_qualifying', 'send_proposal', 'nurture', 'close_deal'];

// Enum guards for the classification fields — hallucinated values must never
// reach the DB (same policy as next_action above).
const SENTIMENTS   = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'];
const SIGNAL_TYPES = ['PRICING', 'INSTALLMENT', 'BATCH', 'CAREER', 'PAYMENT',
  'TRACK_RECORD', 'CONSULTATION', 'CORPORATE', 'ENROLLMENT', 'RISK', 'NONE'];

const QUALIFIER_SCHEMA = `
Respond with ONLY a valid JSON object using this EXACT schema. No prose, no markdown.

{
  "lead_status": "HOT" | "WARM" | "COLD",
  "score": <integer 1-10>,
  "intent": "high" | "medium" | "low",
  "problem_summary": "<1 sentence describing the lead's core problem or interest>",
  "next_action": "continue_qualifying" | "send_proposal" | "nurture" | "close_deal",
  "is_price_objection": <true | false>,
  "is_enrollment_confirmed": <true | false>,
  "business_unit": "DSP" | "SDC" | "UNKNOWN",
  "product": "BOOTCAMP" | "MASTERY" | "UNKNOWN",
  "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "signal_type": "PRICING" | "INSTALLMENT" | "BATCH" | "CAREER" | "PAYMENT" | "TRACK_RECORD" | "CONSULTATION" | "CORPORATE" | "ENROLLMENT" | "RISK" | "NONE"
}

SCORING RULES:
  • 8-10  HOT   — strong buying intent, clear need, urgency, decision authority
  • 5-7   WARM  — interested, asking questions, missing 1+ BANT element
  • 1-4   COLD  — casual browsing, unclear, off-topic, or unqualified

next_action RULES:
  "continue_qualifying" — default for all conversations: questions, greetings, general interest, objections
  "send_proposal"       — lead is WARM/HOT and ready to hear the full offer
  "nurture"             — lead has refused or gone cold, needs re-engagement
  "close_deal"          — lead has confirmed enrollment (is_enrollment_confirmed = true)
  NOTE: "handoff_human" does NOT exist in next_action. Handoff is triggered ONLY by is_enrollment_confirmed=true.

is_price_objection RULES:
  Set to true if the message expresses ANY concern about cost or affordability — in ANY language,
  spelling variant, abbreviation, or mix. Examples (not exhaustive):
  "expensive", "mehnga", "afford nai", "fee zyada hai", "thoda kam", "discount", "budget nahi",
  "too much", "installment", "easy payment", "concession", "kam karo", "can't pay".
  Set to false for everything else.

sentiment RULES (about the LATEST message only, any language / Roman Urdu):
  POSITIVE — enthusiasm, agreement, gratitude, readiness ("great", "zabardast", "kar lete hain", "shukriya")
  NEGATIVE — frustration, complaint, anger, distrust, firm refusal ("bakwas", "abhi tak nahi kiya", "not interested")
  NEUTRAL  — questions, factual asks, greetings, everything else

signal_type RULES — classify the LATEST message's dominant intent (any language):
  PRICING       — fee amount, cost, discount asks
  INSTALLMENT   — installments, payment plan, partial payment
  BATCH         — batch dates, schedule, class timings
  CAREER        — jobs, freelancing, clients, earning outcomes after the course
  PAYMENT       — payment sent/proof/confirmation, receipt, not-yet-processed issues
  TRACK_RECORD  — trainer credentials, certificates, credibility questions
  CONSULTATION  — asks for a call, meeting, or live discussion
  CORPORATE     — team/company training, multiple seats, B2B
  ENROLLMENT    — explicitly ready to enroll / pay / reserve a seat
  RISK          — objection or disengagement threatening the deal (too expensive + walking away, going elsewhere)
  NONE          — greetings, small talk, anything that fits no category

is_enrollment_confirmed — THE ONLY HANDOFF TRIGGER:
  Set to TRUE ONLY if the lead has given an UNAMBIGUOUS, EXPLICIT confirmation to enroll.
  They must clearly mean: "YES I want to register / pay / join RIGHT NOW."

  TRUE examples (enrollment confirmed):
    "haan register karwao", "confirm kar do", "link bhejo main join karta/karti hun",
    "book kar do meri seat", "enroll kar do", "sign me up", "yes I want to join",
    "done, register karo", "chalo karte hain".

  FALSE — ALWAYS false for these (no matter how interested they sound):
    Any information-seeking question about the product, even fee/price ("fee kya hai", "kitna hai", "how much")
    "I saw your ad" / "ad dekha tha" / "maine course dekha"
    Answering a qualifying question: "beginner", "career shift", "freelancer", "income chahiye"
    Background/profile sharing: "mera background IT ka hai", "main student hun", "main freelancer hun"
    Asking about additional offerings: "internship dety ho?", "job placement milti hai?", "certificate milta hai?"
    General interest: "sounds good", "interesting", "theek hai", "achha lagta hai", "ok"
    Asking about schedule, duration, syllabus, certificate, modules, or any course detail
    Greetings or filler: "salam", "alhamdulillah", "ok", "shukriya", "haan" (alone without context)
    ANY message that seeks more information before committing

  THE ONE EXCEPTION to the question rules: a how/where-to-pay question
  ("payment kaise karon", "account number bhejein", "how do I pay") is TRUE — but ONLY
  when the lead has ALREADY clearly agreed to join earlier in THIS conversation.
  The same question from a lead who has not yet said yes is ordinary information-seeking → false.

  THE TEST: ask yourself "Has this person said YES to paying and joining?"
  If there is any doubt → false. The Closer AI keeps selling until the answer is clearly YES.

product RULES (DSP only — which offer this lead is buying):
  "MASTERY"  — the lead wants the SELF-PACED / RECORDED program: says they cannot attend live classes,
               asks for recordings, "apni speed se", "raat ko time nahi", lifetime access, "Mastery",
               "$100", "28,000", asks about the dashboard / certificate for the recorded course,
               or is overseas and mentions time-zone problems.
  "BOOTCAMP" — the lead wants the 7-DAY LIVE bootcamp: batch dates, "Monday se", live class timing,
               "10,000", Zoom, or asks when the next batch starts.
  "UNKNOWN"  — not yet clear. Never guess from price alone if both were discussed; keep UNKNOWN until
               the lead states a preference. Once a lead has chosen, keep returning that value.

business_unit RULES:
  Identify which business the lead is asking about based on their message and conversation history.
  "DSP"     — lead is asking about an AI course, training, digital services program, agentic AI,
              AI mastery, enrollment, batch, certificate, learning AI, freelancing with AI, etc.
  "SDC"     — lead is asking about health products, oils, pain relief, hair fall, weight loss,
              sunnah diagnostic, Zait, Neuro Calm, digestive issues, spiritual healing, black magic,
              Hasad, Sihr, Nazar, Jinn, or any product/remedy from Sunnah Diagnostic.
  "UNKNOWN" — lead's message is a greeting only, completely off-topic, or it is impossible to tell
              which business they are interested in from the conversation so far.
  Once established from prior context, keep returning the same value — do NOT reset to UNKNOWN
  unless the lead explicitly switches to the other business.
`;

// ── Settings-rule handoff detectors ─────────────────────────────────
// Pure functions (no OpenAI call, no DB access) so the rule matching itself
// is unit-testable without spending real API credits or mocking the model.
// Bilingual on purpose — this product's own Qualifier prompt treats
// Urdu/Roman-Urdu as first-class (see is_price_objection above), so a
// human-escalation rule that only understood English would miss most of
// this user base's actual disputes and threats.
const PAYMENT_DISPUTE_PATTERN = /refund|dispute|charge ?back|payment.*fail|failed.*payment|paisay wapis|paise wapas|wapis karo|galat charge|dhoka|fraud hua/i;
const detectPaymentDispute = (message) => PAYMENT_DISPUTE_PATTERN.test(message || '');

const LEGAL_THREAT_PATTERN = /lawyer|vakeel|legal action|sue you|court|adalat|consumer complaint|shikayat karonga|shikayat karungi|\bFBR\b|fraud case|police complaint|fir karonga/i;
const detectLegalThreat = (message) => LEGAL_THREAT_PATTERN.test(message || '');

// Prompt layout is deliberately static-first: the fixed instructions + schema
// (identical for every tenant and every message) form the longest possible
// shared prefix, then the per-tenant business context (stable per tenant),
// and only at the very end the per-lead / per-turn values. OpenAI prompt
// caching discounts the longest exact token prefix (≥1024 tokens) — putting
// a per-lead line before the big static block used to break the cache on
// every single message.
const buildQualifierPrompt = (aiConfig, lead, contact, welcomeVoiceAlreadySent = false, isFirstReplyAfterWelcomeVoice = false) => `
You are the QUALIFIER AGENT for a sales AI system.

Your ONLY job: analyze the lead's latest message + conversation history and output structured JSON.
You do NOT write replies — the Closer AI handles all responses.

## YOUR JOB — SCORE AND ANALYZE ONLY
Assess the lead's temperature, intent, and situation.
The Closer AI will handle ALL responses — questions, objections, general queries, everything.
You NEVER decide to hand off. That is controlled by is_enrollment_confirmed only.

## SCORING
- 8–10 HOT  : clear buying intent, urgency, decision-ready
- 5–7  WARM : interested, asking questions, needs more info or nudging
- 1–4  COLD : greeting, browsing, vague, no commitment shown

## OUTPUT FORMAT
${QUALIFIER_SCHEMA}

## BUSINESS CONTEXT
${aiConfig.systemPrompt}

## LEAD CONTEXT
- Name: ${contact.name || 'Unknown'}
- Pipeline stage: ${lead.stage}
- Previous score: ${lead.aiScore}/100
${welcomeVoiceAlreadySent ? '\nNOTE: A personal welcome voice note from Sardar was already sent as the first reply — do not re-introduce; answer the student\'s question directly.\n' : ''}${isFirstReplyAfterWelcomeVoice ? '\nNOTE: This is the lead\'s first real exchange with you, right after their welcome voice note — they have not had an actual qualifying conversation yet. Set is_enrollment_confirmed = false on this turn no matter how ready or eager they sound (e.g. "reserve my seat", "I want to pay"). Let the Closer have a real exchange first.\n' : ''}`;

const runQualifier = async ({ aiConfig, lead, contact, messageHistory, newMessage, welcomeVoiceAlreadySent = false, isFirstReplyAfterWelcomeVoice = false }) => {
  const t0 = Date.now();
  const system = buildQualifierPrompt(aiConfig, lead, contact, welcomeVoiceAlreadySent, isFirstReplyAfterWelcomeVoice);

  const history = (messageHistory || []).slice(-15).map(m => ({
    role: m.sender === 'CONTACT' ? 'user' : 'assistant',
    content: m.content || '[media]',
  }));
  history.push({ role: 'user', content: newMessage });

  let raw = '';
  let tokens = 0;

  try {
    const resp = await createResponse({
      model: QUALIFIER_MODEL,
      maxOutputTokens: 512,
      instructions: system,
      input: history,
      jsonMode: true,
    });
    raw = resp.choices?.[0]?.message?.content || '';
    tokens = resp.usage?.total_tokens || 0;
  } catch (err) {
    logger.error({ err, leadId: lead.id }, 'Qualifier API call failed');
    throw Object.assign(new Error('Qualifier AI unavailable'), { agent: 'qualifier', statusCode: 503 });
  }

  // Parse + validate
  let parsed;
  try {
    parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
  } catch (e) {
    logger.warn({ raw, leadId: lead.id }, 'Qualifier JSON parse failed');
    throw Object.assign(new Error('Qualifier returned invalid JSON'), { agent: 'qualifier', raw });
  }

  const result = {
    lead_status:        ['HOT','WARM','COLD'].includes(parsed.lead_status) ? parsed.lead_status : 'COLD',
    score:              Math.min(10, Math.max(1, parseInt(parsed.score) || 1)),
    intent:             ['high','medium','low'].includes(parsed.intent) ? parsed.intent : 'low',
    problem_summary:    String(parsed.problem_summary || '').slice(0, 500),
    // Enum-validated like every neighbor: deriveStage() and the worker compare
    // this with === , so a hallucinated value (the model has produced
    // "handoff_human" — a value the schema explicitly says doesn't exist)
    // used to flow raw into the DB and the dashboard's "next steps".
    next_action:        NEXT_ACTIONS.includes(parsed.next_action) ? parsed.next_action : 'continue_qualifying',
    is_enrollment_confirmed: parsed.is_enrollment_confirmed === true,
    is_price_objection: parsed.is_price_objection === true,
    business_unit:      ['DSP','SDC','UNKNOWN'].includes(parsed.business_unit) ? parsed.business_unit : 'UNKNOWN',
    product:            ['BOOTCAMP','MASTERY','UNKNOWN'].includes(parsed.product) ? parsed.product : 'UNKNOWN',
    sentiment:          SENTIMENTS.includes(parsed.sentiment) ? parsed.sentiment : 'NEUTRAL',
    signal_type:        SIGNAL_TYPES.includes(parsed.signal_type) ? parsed.signal_type : 'NONE',
    _tokens:            tokens,
    _model:             QUALIFIER_MODEL,
    _ms:                Date.now() - t0,
  };

  logger.info({ leadId: lead.id, ...result }, '🎯 Qualifier output');
  return result;
};

// =====================================================================
// CLOSER AI  — Elite DSP Course Sales Closer
// =====================================================================

const CLOSER_SCHEMA = `
Respond with ONLY a valid JSON object using this EXACT schema. No prose, no markdown, no code fences.

{
  "reply_message": "<WhatsApp reply — 1 to 3 short lines, ends with a question or CTA, max 320 chars>",
  "closing_type": "soft" | "hard" | "urgent" | "lost",
  "urgency_trigger": "<specific scarcity/urgency fact from product context, or empty string if none>",
  "knowledge_gap": "<ONLY if the lead asked a course-specific factual question (batch dates, payment options, specific modules, refund policy) that is NOT in PRODUCT CONTEXT and you could not answer it. General AI/tech questions you can answer from your own knowledge do NOT count. Leave '' if answered or not applicable>",
  "send_payment_details": <true | false>
}

send_payment_details — set to TRUE when the lead is ready to pay and needs the
account details: they've said yes to enrolling, asked how/where to pay, asked
for the bank account, or asked you to reserve their seat.
  • The system then appends the configured payment instructions verbatim, as a
    separate message. You do NOT write them — see ABSOLUTE RULE 14.
  • Your reply_message should be the short warm lead-in only
    ("Perfect! Yahan account details hain — payment ke baad screenshot bhej dein 👇").
  • Set FALSE for everything else, including general fee questions where the
    lead has not yet decided to pay.

knowledge_gap FORMAT — this field is read by a human business owner, not by you:
  • Write the LEAD'S QUESTION, in English, as a short question — max 8 words.
    ✓ "What is the course fee?"   ✓ "Is a syllabus PDF available?"   ✓ "What is the class size?"
  • NEVER describe the gap itself. Do not write "is not provided", "not in the
    knowledge base", "not in the product context", "product context mein maujood nahi",
    or any variation. Those are statements about you — the owner needs the question.
    ✗ "Fee amount is not provided in the DSP knowledge base."
    ✗ "The user asked whether an LMS is included, which is not in the product context."
  • If the ADDITIONAL KNOWLEDGE BASE below already answers it, use that answer and
    leave knowledge_gap empty — do NOT re-flag a question the owner already answered.

CLOSING TYPE GUIDE:
  • soft    — Phase 1: COLD lead, first few messages. Warm, curious, one qualifying question.
  • hard    — Phase 2: WARM lead, mid-conversation. Present value, ask for slot confirmation.
  • urgent  — Phase 3: HOT lead, late conversation. Direct price + enrollment ask. Close NOW.
  • lost    — Lead has clearly and repeatedly refused after your best re-engagement attempts.
              Use ONLY when: you have already tried at least 2 objection-handling responses AND
              the lead is still saying things like "nahi chahiye", "not interested", "chhodo",
              "no thanks", "mujhe nahi lena", "koi interest nahi". Send a polite farewell and
              leave the door open ("Koi baat nahi — kabhi bhi interested hon to bata dena 🙏").
              reply_message must be a graceful goodbye, NOT another sales pitch.
`;

// Same static-first layout rationale as buildQualifierPrompt above — this
// template is ~10KB of fixed playbook/rules text, and it used to sit AFTER
// the per-message Qualifier output, which zeroed the cacheable prefix on
// every call. Order now: fixed instructions (shared by all tenants) →
// per-tenant product context → per-message dynamic tail.
const buildCloserPrompt = (aiConfig, lead, contact, qualifierOutput, messageCount, resolvedQAs = [], welcomeVoiceAlreadySent = false, isFirstReplyAfterWelcomeVoice = false) => `
You are an elite AI Sales Closer specializing in converting WhatsApp leads into paid course enrollments.

Your ONLY job: generate ONE perfectly-calibrated reply that moves this specific lead one step closer to enrolling.
Output structured JSON. No explanations outside the JSON.

The PRODUCT & BUSINESS CONTEXT section near the end of this prompt is your single
source of truth for every product fact. The QUALIFIER INTELLIGENCE section at the
very end describes the specific lead you are replying to right now.

═══════════════════════════════════════════════════════
YOUR 3-PHASE SALES PLAYBOOK  (match phase to score)
═══════════════════════════════════════════════════════

These phases describe HOW to move a lead, never WHAT to say about the product.
Every product fact — price, duration, schedule, certificates, what's included —
comes from PRODUCT CONTEXT and nowhere else. The examples below are
sentence SHAPES with the facts left blank: fill them from PRODUCT CONTEXT, and
if a fact isn't there, don't reach for one.
Message counts below refer to how many messages the LEAD has sent (their side
only) — the "Lead messages so far" number in QUALIFIER INTELLIGENCE.

── PHASE 1 · QUALIFY & SPARK CURIOSITY  (score 1–4, lead messages 1–3) ──
Goal: discover their pain / desire. Ask ONE question. Do NOT pitch. Do NOT mention price yet.
Tone: friendly, curious, helpful.
Ask about their GOAL, never their personal details:
  → what they want out of AI — income, a job, automating their own work
  → whether they've tried any AI tool before
Do not ask for city, profession, phone number, or anything PRODUCT CONTEXT
tells you not to ask. Every reply in Phase 1 MUST end with a question.

── PHASE 2 · PRESENT VALUE & BUILD DESIRE  (score 5–7, lead messages 4–8) ──
Goal: map their specific goal to the course outcome. Create desire. Handle objections.
Lead with OUTCOME not features — what they'll be able to DO afterwards, framed
in the exact duration and deliverables PRODUCT CONTEXT states.
One FOMO hook, but only from a real fact in PRODUCT CONTEXT (batch start day,
live sessions, seat limits). Then ask for a soft commitment — "shall I reserve
your seat for the next batch?"

── PHASE 3 · CLOSE — ASK FOR THE SALE  (score 8–10, lead messages 9+) ──
Goal: remove final friction. State the offer once, clearly. Ask directly.
They already know the product. Stop explaining. Start closing.
Name the fee and the duration exactly as PRODUCT CONTEXT gives them, then make
one direct ask ("Seat confirm kar dun?" / "Shall I reserve your seat?").
Do NOT re-pitch. Do NOT invent a next step PRODUCT CONTEXT doesn't describe.

═══════════════════════════════════════════════════════
OBJECTION PLAYBOOK  (deploy instantly when triggered)
═══════════════════════════════════════════════════════
Handle the emotion first, then answer with a fact from PRODUCT CONTEXT. Never
answer an objection with a fact you cannot point to there.
"I don't know AI / AI nahi aata"  → reassure it's built for beginners, if PRODUCT CONTEXT says so
"No time / time nahi"             → give the REAL time commitment from PRODUCT CONTEXT
"Too expensive / mehnga hai"      → reframe the fee as an investment; never discount, never invent a plan
"Need to think / sochna hai"      → offer one concrete detail, then ask to reserve
"Later / baad mein karunga"       → point to the real next batch timing from PRODUCT CONTEXT
"What's the guarantee?"           → describe what they actually build/receive, per PRODUCT CONTEXT
"Is it recorded?"                 → answer ONLY from PRODUCT CONTEXT. If it doesn't say, say you'll confirm — never assume recordings exist
"Is it for beginners?"            → confirm if PRODUCT CONTEXT says so

═══════════════════════════════════════════════════════
REFUSAL RE-ENGAGEMENT  (when lead says "no" or "not interested")
═══════════════════════════════════════════════════════
First refusal → acknowledge + pivot to their specific pain, try one more angle:
  "Bilkul, koi pressure nahi. Ek cheez poochh sakta hun — AI seekhne ka koi aur plan hai aap ka?"
Second refusal → final soft attempt with a door-open close:
  "Samajh gaya. Agar kabhi AI income ka plan ho to hum yahan hain. Best of luck! 🙏"
  → set closing_type = "lost" in the JSON.
Third+ refusal → closing_type = "lost" immediately. Send graceful goodbye. Stop pitching.

NEVER say "hamari team connect karegi" or "someone will be in touch" if the lead has NOT confirmed enrollment.
DO NOT hand off to human just because they asked about fee, duration, or any product detail.

═══════════════════════════════════════════════════════
ABSOLUTE RULES  (never break these)
═══════════════════════════════════════════════════════
1. DO NOT say "team will connect", "someone will get in touch", or any hand-off phrase UNLESS the lead has said YES to enrolling.
   YOU are closing this lead. The human agent only takes over after enrollment is confirmed.
2. DO NOT use "ji" after names (never "Mohsin ji", "Sundus ji"). Use "sir" / "madam" alone.
3. DO NOT use "bhai" — use "sir".
4. EVERY message (except closing_type="lost" goodbye) MUST end with a question OR a clear CTA.
5. LANGUAGE RULE — strictly mirror the lead's language:
   • Lead writes in English only → reply 100% in English. No Urdu words at all.
   • Lead writes in Urdu only → reply in Urdu/Roman Urdu.
   • Lead mixes Urdu + English → match the same mix.
   Detect from the CURRENT message, not earlier ones. If they switch language, you switch too.
6. KNOWLEDGE RULES — two tiers:
   a) COURSE FACTS (price, batch dates, seat count, certificate type, payment method):
      → ONLY use what's in PRODUCT CONTEXT. Never invent these.
   b) GENERAL AI/TECH KNOWLEDGE (how agents work, what LLMs are, Python, automation, tools,
      freelancing tips, industry trends, "agents kaise bante hain", "ChatGPT kya hai", etc.):
      → Use your full training knowledge to ANSWER the question, then pivot back to the course.
      Do NOT flag general AI questions as knowledge_gap — you know this already.
      This is for answering informational questions ONLY — it does NOT authorize offering,
      selling, or agreeing to provide anything beyond this course (see rule 12).
7. FEE QUESTIONS are NORMAL — never deflect one and never hand it to a human. State the fee
   exactly as PRODUCT CONTEXT gives it, then close. If PRODUCT CONTEXT does not state a fee,
   say you'll confirm it — do NOT quote a number from memory — and flag it as knowledge_gap.
8. If lead mentions seeing an ad → validate it ("Haan, bilkul!"), briefly pitch, ask one qualifying question.
9. Urgency is ONLY valid when grounded in real facts from PRODUCT CONTEXT.
10. NEVER invent course-specific facts not in PRODUCT CONTEXT (dates, guarantees, partner names, etc.).
11. NEVER offer a discount, installment plan, custom payment schedule, or any other commercial
    concession that isn't explicitly stated in PRODUCT CONTEXT — even if the lead pushes back on
    price or asks directly. Restate the fee as-is (rule 7) and hold firm; do not invent flexibility
    that doesn't exist just to keep the lead engaged.
12. NEVER offer, discuss providing, or agree to deliver ANY service other than this course itself —
    e.g. SEO, freelance/consulting work, custom AI builds, website work, or anything else, even if
    it's AI/tech-related and even under rule 6b. Rule 6b only covers answering how-things-work
    questions — it never authorizes proposing an out-of-scope engagement. If a lead asks for
    something outside this course, briefly acknowledge it and redirect to the course; never agree
    to it or imply DSP will provide it.
13. NEVER repeat a reply you have already sent. Read your own previous messages in the
    conversation above — if the lead re-sends the same question, or sends a short follow-up
    ("?", "ok", "acha", "hello") after you already answered, do NOT paste the same answer
    again. Acknowledge that you already shared it and move the conversation forward with a
    NEW angle or a direct ask ("Jaise maine bataya — seat confirm kar dun?").
14. NEVER type out bank account numbers, IBANs, branch codes or any payment credentials, even
    if they appear in PRODUCT CONTEXT. The system sends those verbatim from configuration — a
    single mistyped digit costs the lead their money. When the lead is ready to pay, write the
    warm one-line intro only and set send_payment_details = true (see OUTPUT FORMAT).

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════
${CLOSER_SCHEMA}

═══════════════════════════════════════════════════════
PRODUCT & BUSINESS CONTEXT (your source of truth)
═══════════════════════════════════════════════════════
${aiConfig.systemPrompt}${resolvedQAs.length > 0 ? `

── ADDITIONAL KNOWLEDGE BASE (admin-verified answers) ──
The following Q&As have been answered by the business owner. Use them exactly as written when relevant.
${resolvedQAs.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join('\n\n')}` : ''}

${aiConfig.closingScript ? `ADDITIONAL CLOSING GUIDANCE:\n${aiConfig.closingScript}` : ''}

═══════════════════════════════════════════════════════
QUALIFIER INTELLIGENCE (upstream analysis of THIS lead)
═══════════════════════════════════════════════════════
Temperature : ${qualifierOutput.lead_status}   Score: ${qualifierOutput.score}/10   Intent: ${qualifierOutput.intent}
Lead's situation: ${qualifierOutput.problem_summary}
Recommended next move: ${qualifierOutput.next_action}
Offer the lead is on : ${qualifierOutput.product && qualifierOutput.product !== 'UNKNOWN' ? qualifierOutput.product : 'not chosen yet — if they ask about recordings, self-paced or cannot attend live, present AI AGENT MASTERY from PRODUCT CONTEXT; otherwise present the live bootcamp'}
Lead messages so far (including this one): ${messageCount}
${qualifierOutput.is_price_objection ? '⚠️  PRICE OBJECTION DETECTED — deploy the objection playbook immediately. Do NOT skip to close. Handle the concern, then pivot.' : ''}

CONTACT
Name: ${contact.name || 'Unknown'} | Pipeline stage: ${lead.stage}
${welcomeVoiceAlreadySent ? '\nNOTE: A personal welcome voice note from Sardar was already sent as the first reply — do not re-introduce; answer the student\'s question directly.\n' : ''}${isFirstReplyAfterWelcomeVoice ? `
⚠️  FIRST REAL EXCHANGE — set send_payment_details = false on this reply, no exceptions.
This lead has only received the welcome voice note — you have not actually talked to them
yet. Even if they say "reserve my seat", "I want to pay", or sound fully ready, treat this
as Phase 1: have a genuine qualifying exchange first (ask about their goal/background per
the playbook above). If they still want to proceed, payment details can go out starting
from their NEXT message. This is a hard rule for this turn only, not the rest of the
conversation.
` : ''}`;

// Hard technical block — rules 11/12 above are prompt-level instructions,
// which the model can still ignore (it has before). This is enforcement,
// not persuasion: it inspects the actual generated reply_message and vetoes
// it outright if it contains a discount/installment/out-of-scope offer,
// regardless of what the model decided to write. The ONLY thing this bot
// is ever allowed to sell is DSP admission — nothing else, no exceptions.
// Deliberately scoped tight to the exact violations seen in production —
// e.g. NOT "freelance"/"consulting", since the Closer's own legitimate
// script already asks "Freelancing karte hain ya job ki talash mein hain?"
// and a broader pattern would veto that real qualifying question too.
const OUT_OF_SCOPE_REPLY_PATTERNS = [
  /\bdiscount(s|ed)?\b/i,
  /\binstall?ment(s)?\b/i,
  /\d+\s*%\s*(off|discount)/i,
  /\bwaiver\b/i,
  /\bSEO\b/i,
];

const containsOutOfScopeOffer = (text) => {
  if (!text) return false;
  return OUT_OF_SCOPE_REPLY_PATTERNS.some((re) => re.test(text));
};

const SAFE_FALLBACK_REPLY =
  'DSP AI Agents Bootcamp ka fee fixed hai — koi discount ya kisi aur service ka option available nahi. ' +
  'Kya main aapko seat confirm karne mein madad karun?';

const runCloser = async ({ aiConfig, lead, contact, messageHistory, newMessage, qualifierOutput, resolvedQAs = [], welcomeVoiceAlreadySent = false, isFirstReplyAfterWelcomeVoice = false }) => {
  const t0 = Date.now();
  // The playbook's phase thresholds (lead messages 1–3 / 4–8 / 9+) count the
  // LEAD's messages only. The old raw history length counted both sides, so a
  // lead's 2nd message could arrive as "message 5" and the Closer skipped
  // straight past qualifying into the value pitch. +1 is the inbound message
  // being answered, which the worker excludes from messageHistory.
  const messageCount = (messageHistory || []).filter((m) => m.sender === 'CONTACT').length + 1;
  const system = buildCloserPrompt(aiConfig, lead, contact, qualifierOutput, messageCount, resolvedQAs, welcomeVoiceAlreadySent, isFirstReplyAfterWelcomeVoice);

  const history = (messageHistory || []).slice(-20).map(m => ({
    role: m.sender === 'CONTACT' ? 'user' : 'assistant',
    content: m.content || '[media]',
  }));
  history.push({ role: 'user', content: newMessage });

  let raw = '';
  let tokens = 0;

  try {
    const resp = await createResponse({
      model: CLOSER_MODEL,
      maxOutputTokens: aiConfig.maxTokens || 1024,
      instructions: system,
      input: history,
      jsonMode: true,
    });
    raw = resp.choices?.[0]?.message?.content || '';
    tokens = resp.usage?.total_tokens || 0;
  } catch (err) {
    logger.error({ err, leadId: lead.id }, 'Closer API call failed');
    throw Object.assign(new Error('Closer AI unavailable'), { agent: 'closer', statusCode: 503 });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
  } catch (e) {
    logger.warn({ raw, leadId: lead.id }, 'Closer JSON parse failed');
    throw Object.assign(new Error('Closer returned invalid JSON'), { agent: 'closer', raw });
  }

  const rawReplyMessage = String(parsed.reply_message || '').slice(0, 1000);
  const blocked = containsOutOfScopeOffer(rawReplyMessage);
  if (blocked) {
    logger.warn({ leadId: lead.id, raw: rawReplyMessage }, '🚫 Closer reply vetoed — contained discount/installment/out-of-scope offer');
  }

  const result = {
    reply_message:   blocked ? SAFE_FALLBACK_REPLY : rawReplyMessage,
    closing_type:    ['soft','hard','urgent','lost'].includes(parsed.closing_type) ? parsed.closing_type : 'soft',
    urgency_trigger: String(parsed.urgency_trigger || '').slice(0, 200),
    knowledge_gap:   String(parsed.knowledge_gap || '').trim().slice(0, 500),
    // A vetoed reply is no longer the reply the model wrote, so its intent to
    // send payment details doesn't carry over to the fallback text.
    // Deterministic override, not just a prompt instruction: right after the
    // welcome voice note, payment details can never fire — the lead hasn't
    // had a real qualifying exchange yet, even if their message sounds ready.
    send_payment_details: !blocked && !isFirstReplyAfterWelcomeVoice && parsed.send_payment_details === true,
    _tokens:         tokens,
    _model:          CLOSER_MODEL,
    _ms:             Date.now() - t0,
  };

  logger.info({ leadId: lead.id, closing_type: result.closing_type, knowledge_gap: result.knowledge_gap || null }, '💬 Closer output');
  return result;
};

// =====================================================================
// LEAD STATUS → STAGE MAPPING
// =====================================================================

const deriveStage = (currentStage, qualifierOutput) => {
  // Don't downgrade stages that have already advanced
  const order = ['NEW','QUALIFYING','DIAGNOSED','PROPOSED','CLOSED_WON','CLOSED_LOST'];
  const currentIdx = order.indexOf(currentStage);

  let target = currentStage;
  // close_deal stops at PROPOSED, not CLOSED_WON. The Qualifier setting
  // close_deal means the lead SAID yes — it is an intention, not money in the
  // account, and nobody has looked at a bank statement yet. Marking it won here
  // made won revenue count intentions, and (until the worker's awaiting-proof
  // lookup) it also closed the lead out from under the screenshot that was
  // still on its way. CLOSED_WON is now reachable only through
  // confirmPayment() — a human verifying the transfer.
  if (qualifierOutput.next_action === 'close_deal')      target = 'PROPOSED';
  else if (qualifierOutput.next_action === 'send_proposal') target = 'PROPOSED';
  else if (qualifierOutput.lead_status === 'HOT')        target = 'DIAGNOSED';
  else if (qualifierOutput.lead_status === 'WARM' && currentStage === 'NEW') target = 'QUALIFYING';

  const targetIdx = order.indexOf(target);
  return targetIdx > currentIdx ? target : currentStage;
};

// =====================================================================
// MAIN ORCHESTRATOR — used by the worker
// =====================================================================
// Returns the same shape as v1 processMessage() so the worker doesn't break.
// Adds: qualifierOutput, closerOutput, humanFollowupRequired

const processMessage = async ({ tenantId, lead, contact, conversation, newMessage, messageHistory, handedBackToAI = false, welcomeVoiceAlreadySent = false }) => {
  const aiConfig = await prisma.aiConfig.findUnique({ where: { tenantId } });
  if (!aiConfig) throw new Error(`No AI config found for tenant ${tenantId}`);

  // The turn right after the welcome voice note (message history so far is
  // just [their first text, the outbound voice note]) — the lead hasn't had
  // an actual conversation yet, so even a "reserve my seat" here shouldn't
  // skip straight to payment/handoff. Scoped to this one turn only, not
  // welcomeVoiceAlreadySent's full remaining lifetime, so real conversions
  // later in the conversation are never blocked.
  const isFirstReplyAfterWelcomeVoice = welcomeVoiceAlreadySent && (messageHistory || []).length <= 2;

  // ── 1. QUALIFIER ────────────────────────────────────────────
  let qualifierOutput;
  try {
    qualifierOutput = await runQualifier({ aiConfig, lead, contact, messageHistory, newMessage, welcomeVoiceAlreadySent, isFirstReplyAfterWelcomeVoice });
  } catch (err) {
    // Qualifier failed — use safe defaults and let the Closer keep selling.
    // A Qualifier error must NEVER cause a handoff; the lead deserves a reply.
    logger.error({ err, leadId: lead.id }, 'Qualifier failed — using safe defaults, Closer will handle');
    qualifierOutput = {
      lead_status:             lead.scoreLabel || 'WARM',
      score:                   Math.round((lead.aiScore || 0) / 10) || 5,
      intent:                  'medium',
      problem_summary:         'Qualifier unavailable — continuing conversation',
      next_action:             'continue_qualifying',
      is_price_objection:      false,
      is_enrollment_confirmed: false,
      sentiment:               'NEUTRAL',
      signal_type:             'NONE',
      _tokens: 0, _model: QUALIFIER_MODEL, _ms: 0,
    };
  }

  // ── 2. Single handoff gate — is_enrollment_confirmed is the ONLY trigger ──
  // The Qualifier no longer outputs handoff_human in next_action.
  // Handoff fires ONLY when the lead has explicitly confirmed enrollment.
  // Plus settings-based rules for payment disputes / legal threats.
  //
  // Settings.jsx exposes four toggles (handoffRules: payment, unanswered,
  // legal, hotProposal — DEFAULT_RULES there is { payment: true,
  // unanswered: true, legal: true, hotProposal: false }). Until now, only
  // `payment` actually did anything: `legal` and `unanswered` were checked
  // nowhere, and `hotProposal`'s notification fired unconditionally
  // regardless of the toggle. A tenant could turn on "escalate on legal
  // threat," believe it protected them, and it silently did nothing.
  //
  // buildEffectiveTriggers() above was apparently meant to drive this via a
  // trigger-name list fed to the model, but was never called from anywhere —
  // dead code. Superseded here by explicit regex rules matching the pattern
  // `payment` already used successfully, rather than adding a new field to
  // the Qualifier's JSON schema, which would risk diluting its classification
  // quality on the fields the live pipeline already depends on. Deleted
  // rather than left in place looking load-bearing when it isn't.
  const rules = aiConfig.handoffRules || {};
  let rulesHandoff = false;
  let rulesHandoffReason = null;

  // Settings rule: payment disputes / refund requests → always human.
  // Previously English-only, in a product whose own Qualifier prompt treats
  // Urdu/Roman-Urdu as first-class (see is_price_objection's own example
  // list) — a lead disputing a charge in Urdu was invisible to this rule.
  if (rules.payment !== false && detectPaymentDispute(newMessage)) {
    rulesHandoff = true;
    rulesHandoffReason = 'Payment dispute detected — human required';
    logger.info({ leadId: lead.id }, '🛡 Rule: payment dispute → handoff');
  }

  // Settings rule: legal threats / consumer complaints → always human.
  // Net new — this toggle existed in the UI and did nothing.
  if (!rulesHandoff && rules.legal !== false && detectLegalThreat(newMessage)) {
    rulesHandoff = true;
    rulesHandoffReason = 'Legal threat or complaint detected — human required';
    logger.info({ leadId: lead.id }, '🛡 Rule: legal threat → handoff');
  }

  // Primary gate: Qualifier (claude-sonnet-4-6) decides when enrollment is confirmed.
  // No hardcoded rules — the model reads the conversation and makes the call.
  // Deterministic override, not just a prompt instruction: on the turn right
  // after the welcome voice note, enrollment can never auto-confirm — the
  // lead hasn't had an actual qualifying conversation yet.
  const enrollmentConfirmed = !handedBackToAI && !isFirstReplyAfterWelcomeVoice && qualifierOutput.is_enrollment_confirmed === true;
  const forceHandoff = enrollmentConfirmed || rulesHandoff;

  // hotProposal defaults to false in Settings.jsx (opt-in, unlike the other
  // three rules which default true), but this notification previously fired
  // unconditionally, ignoring the toggle entirely — every tenant got it
  // whether they'd asked for it or not. Now respects the default: a tenant
  // who never touched this setting stops getting the WhatsApp ping, and
  // gets it back by explicitly turning it on. Flagged prominently in the PR
  // description, not just this comment, since it changes default behavior.
  const humanFollowupRequired =
    (qualifierOutput.score >= 8 || qualifierOutput.lead_status === 'HOT') && rules.hotProposal === true;

  // ── 5. CLOSER ───────────────────────────────────────────────
  // Fetch admin-verified Q&As to inject into Closer's knowledge base
  let resolvedQAs = [];
  try {
    resolvedQAs = await kgSvc.getResolvedQAs(tenantId);
  } catch (_) { /* non-blocking */ }

  let closerOutput = null;
  let closerError = null;
  if (!forceHandoff) {
    try {
      closerOutput = await runCloser({ aiConfig, lead, contact, messageHistory, newMessage, qualifierOutput, resolvedQAs, welcomeVoiceAlreadySent, isFirstReplyAfterWelcomeVoice });
    } catch (err) {
      logger.error({ err, leadId: lead.id }, 'Closer failed — using safe fallback reply');
      closerError = err.message;
      // Build a safe context-aware fallback rather than handing off.
      // A technical error must never interrupt a live sales conversation.
      // These strings are sent verbatim without the model seeing PRODUCT
      // CONTEXT, so they must never state a course fact — no price, no
      // duration. Acknowledge and keep the lead talking; nothing more.
      const fallbackReply = qualifierOutput.is_price_objection
        ? 'Bilkul samajh sakta hun — ye ek investment hai jo aapko aage le jaye. Kya main thodi aur detail share karun? 😊'
        : 'Shukriya message ke liye! Aap ka koi sawal ho to zaroor poochein — main yahan hun. 😊';
      closerOutput = {
        reply_message:   fallbackReply,
        closing_type:    'soft',
        urgency_trigger: '',
        knowledge_gap:   '',
        send_payment_details: false,
        _tokens: 0, _model: CLOSER_MODEL, _ms: 0,
      };
      closerError = null; // treat as non-fatal
    }
  }

  // ── 5b. Log knowledge gap if Closer flagged one ─────────────
  if (closerOutput?.knowledge_gap) {
    kgSvc.logGap(tenantId, {
      question: closerOutput.knowledge_gap,
      exampleLead: contact.id || null,
    }).catch(err => logger.warn({ err }, 'KnowledgeGap log failed (non-blocking)'));
  }

  // ── 6. Determine final action ───────────────────────────────
  let action = 'continue';
  let handoffReason = null;

  if (forceHandoff) {
    action = 'handoff';
    handoffReason = rulesHandoffReason
      || `Lead confirmed enrollment (score=${qualifierOutput.score}, intent=${qualifierOutput.intent})`;
  } else if (closerError) {
    action = 'handoff';
    handoffReason = `Closer AI failed: ${closerError}`;
  } else if (closerOutput?.closing_type === 'lost') {
    // Lead has clearly refused after multiple re-engagement attempts → mark as lost
    action = 'close_lost';
    logger.info({ leadId: lead.id }, '☠️  Closer marked lead as LOST after repeated refusal');
  } else if (qualifierOutput.next_action === 'close_deal') {
    action = 'close';
  }

  // ── 6. Map qualifier 1-10 score → DB 0-100 + derive stage ──
  const stage    = deriveStage(lead.stage, qualifierOutput);
  const aiScore  = qualifierOutput.score * 10;
  const reply    = closerOutput?.reply_message || null;

  // ── 7. Log to AiAgentLog (audit trail for Analyst AI v2) ────
  await prisma.aiAgentLog.create({
    data: {
      tenantId,
      leadId: lead.id,
      conversationId: conversation.id,
      qualifierOutput: {
        lead_status:     qualifierOutput.lead_status,
        score:           qualifierOutput.score,
        intent:          qualifierOutput.intent,
        problem_summary: qualifierOutput.problem_summary,
        next_action:     qualifierOutput.next_action,
      },
      qualifierTokens: qualifierOutput._tokens,
      qualifierModel:  qualifierOutput._model,
      qualifierMs:     qualifierOutput._ms,
      closerOutput:    closerOutput ? {
        reply_message:   closerOutput.reply_message,
        closing_type:    closerOutput.closing_type,
        urgency_trigger: closerOutput.urgency_trigger,
      } : null,
      closerTokens:    closerOutput?._tokens || 0,
      closerModel:     closerOutput?._model || null,
      closerMs:        closerOutput?._ms || 0,
      finalAction:     action,
      errorReason:     closerError,
    },
  }).catch(err => logger.warn({ err }, 'AiAgentLog write failed (non-blocking)'));

  // ── 8. Update token usage for billing ───────────────────────
  const totalTokens = (qualifierOutput._tokens || 0) + (closerOutput?._tokens || 0);
  // upsert, not update: a tenant with no Subscription row made this throw on
  // every message, and the empty catch swallowed it — so AI spend silently
  // stopped being recorded and the monthly budget cap stopped being
  // enforceable. Every other column has a default, so tenantId is enough.
  await prisma.subscription.upsert({
    where:  { tenantId },
    update: { aiTokensUsed: { increment: totalTokens } },
    create: { tenantId, aiTokensUsed: BigInt(totalTokens) },
  }).catch(err => logger.warn({ err, tenantId }, 'Token usage update failed (non-blocking)'));

  // ── 9. Return v1-compatible shape (+ v1.5 extras) ───────────
  return {
    // v1 contract — worker reads these
    reply,
    leadStatus:        qualifierOutput.lead_status,
    score:             qualifierOutput.score,        // 1-10
    aiScore,                                          // 0-100 for DB
    stage,
    problemDiagnosis:  qualifierOutput.problem_summary,
    salesFix:          closerOutput?.reply_message ? `Reply sent (${closerOutput.closing_type})` : null,
    urgencyTrigger:    closerOutput?.urgency_trigger || null,
    sendPaymentDetails: closerOutput?.send_payment_details === true,
    enrollmentConfirmed,
    action,
    handoffReason,
    qualificationData: {
      intent:          qualifierOutput.intent,
      problem_summary: qualifierOutput.problem_summary,
      next_action:     qualifierOutput.next_action,
      closing_type:    closerOutput?.closing_type || null,
    },
    nextSteps:         qualifierOutput.next_action,

    // v1.5 additions
    humanFollowupRequired,
    intent:            qualifierOutput.intent,
    problemSummary:    qualifierOutput.problem_summary,
    nextAction:        qualifierOutput.next_action,
    businessUnit:      qualifierOutput.business_unit,
    product:           qualifierOutput.product,
    sentiment:         qualifierOutput.sentiment || 'NEUTRAL',
    signalType:        (qualifierOutput.signal_type && qualifierOutput.signal_type !== 'NONE')
                         ? qualifierOutput.signal_type : null,
    qualifierOutput,
    closerOutput,

    // bookkeeping
    tokensUsed:        totalTokens,
    qualifierTokens:   qualifierOutput._tokens,
    closerTokens:      closerOutput?._tokens || 0,
    qualifierMs:       qualifierOutput._ms,
    closerMs:          closerOutput?._ms || 0,
    qualifierModel:    QUALIFIER_MODEL,
    closerModel:       CLOSER_MODEL,
  };
};

// =====================================================================
// PAYMENT PROOF IMAGE CLASSIFICATION
// =====================================================================
// The worker's payment-proof branch used to trust `messageType === 'image'`
// alone (see conversation.worker.js §6c) — any photo sent after payment
// instructions went out got auto-confirmed as "payment received," including
// unrelated screenshots (refund-policy text, ID cards, memes). This is the
// one real content check in that path: a small, cheap, single-purpose vision
// call that answers exactly one question — does this image look like a bank
// transfer / payment receipt? — before the worker is allowed to send a
// confirmation the lead will read as "you're enrolled."
//
// Fails CLOSED on purpose: if the vision call errors out (bad key, timeout,
// model outage) this returns isPaymentProof: false rather than silently
// falling back to the old "trust the message type" behavior — a missed
// auto-confirmation just means a human verifies it a little sooner, whereas
// a wrong auto-confirmation is the actual incident this exists to prevent.

const classifyPaymentProofImage = async (buffer, mimeType) => {
  try {
    const base64 = buffer.toString('base64');
    const res = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      max_completion_tokens: 120,
      messages: [
        {
          role: 'system',
          content: 'You classify a single WhatsApp image. Reply with strict JSON only: ' +
            '{"isPaymentProof": boolean, "reason": string, "amount": number|null, "currency": string|null, "date": string|null, "reference": string|null}. ' +
            'isPaymentProof is true ONLY if the image is a bank transfer receipt, payment app confirmation screen, or transaction screenshot showing an amount and a date/reference number. ' +
            'It is false for anything else — policy text, chat screenshots, ID cards/documents, unrelated photos — even if money-related words appear in it. ' +
            'When isPaymentProof is true, also extract what the receipt shows: amount as a plain number (no separators), currency as the ISO/displayed code (e.g. "PKR"), date as shown (ISO if possible), reference as the transaction/reference id string. ' +
            'Use null for any field not clearly readable — NEVER guess.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Classify this image.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || '{}');
    const amount = Number(parsed.amount);
    return {
      isPaymentProof: parsed.isPaymentProof === true,
      reason: parsed.reason || null,
      // Extracted receipt fields — read by the human reviewer (surfaced in
      // the Activity + admin notification), never used to auto-approve.
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      currency: parsed.currency ? String(parsed.currency).slice(0, 10) : null,
      date: parsed.date ? String(parsed.date).slice(0, 40) : null,
      reference: parsed.reference ? String(parsed.reference).slice(0, 100) : null,
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'Payment-proof image classification failed — treating as not-proof (fail closed)');
    return { isPaymentProof: false, reason: 'classification_failed', amount: null, currency: null, date: null, reference: null };
  }
};

// =====================================================================
// SUMMARY (unchanged from v1 — used by Conversations page)
// =====================================================================

const generateSummary = async ({ tenantId, messageHistory }) => {
  const messages = (messageHistory || []).slice(-30).map(m => ({
    role: m.sender === 'CONTACT' ? 'user' : 'assistant',
    content: m.content || '[media]',
  }));

  const response = await createResponse({
    model: env.OPENAI_MODEL,
    maxOutputTokens: 300,
    instructions: 'You are a CRM assistant. Summarize this sales conversation in 3-5 bullet points. Focus on: lead need, budget signals, objections, and next steps. Respond in the same language as the conversation.',
    input: messages,
  });

  return response.choices?.[0]?.message?.content || 'Unable to generate summary.';
};

module.exports = {
  processMessage,
  generateSummary,
  // exposed for direct use / testing
  runQualifier,
  runCloser,
  detectPaymentDispute,
  detectLegalThreat,
  classifyPaymentProofImage,
};
