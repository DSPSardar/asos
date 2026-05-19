// src/services/claude.service.js
// ASOS v1.5 — Dual AI Agent System
//
//   Qualifier AI  →  analyzes message, scores lead, classifies intent
//   Closer AI     →  generates persuasive WhatsApp reply
//
// Both agents return strict JSON. Sequential pipeline, modular by design.
// processMessage() is kept as a thin wrapper so the worker / existing API
// surface is unchanged.

const Anthropic = require('@anthropic-ai/sdk');
const env = require('../config/env');
const logger = require('../utils/logger');
const prisma = require('../config/database');
const kgSvc = require('../modules/knowledge-gaps/knowledge-gaps.service');

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ── Model selection (per-agent) ───────────────────────────────────────
// Qualifier = fast/cheap (analytic). Closer = better copy.
const QUALIFIER_MODEL = env.QUALIFIER_MODEL || 'claude-haiku-4-5';
const CLOSER_MODEL    = env.CLOSER_MODEL    || env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';

// =====================================================================
// QUALIFIER AI
// =====================================================================

const QUALIFIER_SCHEMA = `
Respond with ONLY a valid JSON object using this EXACT schema. No prose, no markdown.

{
  "lead_status": "HOT" | "WARM" | "COLD",
  "score": <integer 1-10>,
  "intent": "high" | "medium" | "low",
  "problem_summary": "<1 sentence describing the lead's core problem or interest>",
  "next_action": "continue_qualifying" | "send_proposal" | "nurture" | "close_deal",
  "is_price_objection": <true | false>,
  "is_enrollment_confirmed": <true | false>
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
  "expensive", "mehnga", "afford nai", "10k zyada", "thoda kam", "discount", "budget nahi",
  "too much", "installment", "easy payment", "concession", "kam karo", "can't pay".
  Set to false for everything else.

is_enrollment_confirmed — THE ONLY HANDOFF TRIGGER:
  Set to TRUE ONLY if the lead has given an UNAMBIGUOUS, EXPLICIT confirmation to enroll.
  They must clearly mean: "YES I want to register / pay / join RIGHT NOW."

  TRUE examples (enrollment confirmed):
    "haan register karwao", "confirm kar do", "link bhejo main join karta/karti hun",
    "book kar do meri seat", "enroll kar do", "sign me up", "yes I want to join",
    "payment kaise karon" (said AFTER agreeing to join), "done, register karo", "chalo karte hain".

  FALSE — ALWAYS false for these (no matter how interested they sound):
    Any question, even fee/price ("fee kya hai", "kitna hai", "how much")
    "I saw your ad" / "ad dekha tha" / "maine course dekha"
    Answering a qualifying question: "beginner", "career shift", "freelancer", "income chahiye"
    General interest: "sounds good", "interesting", "theek hai", "achha lagta hai"
    Asking about schedule, duration, syllabus, certificate, or any course detail
    Greetings or filler: "salam", "alhamdulillah", "ok", "shukriya", "haan" (alone without context)
    ANY message that seeks information — even if the person sounds very keen

  DEFAULT is false. When in ANY doubt → false. The Closer AI keeps selling until confirmed.
`;

// Build effective handoff triggers dynamically from the tenant's handoffRules toggles.
// handoffRules = { payment: bool, legal: bool, unanswered: bool, hotProposal: bool }
// handoffTriggers = admin-defined custom array (optional override)
const buildEffectiveTriggers = (aiConfig) => {
  const rules = aiConfig.handoffRules || {};
  const triggers = new Set(['seat_confirmed']); // always active

  if (rules.payment !== false) {
    // payment ON by default — these are genuine human-only situations
    ['payment_dispute', 'refund_request', 'charge_dispute', 'billing_error'].forEach(t => triggers.add(t));
  }
  if (rules.legal !== false) {
    ['legal_threat', 'lawsuit', 'consumer_complaint', 'FBR', 'fraud_allegation'].forEach(t => triggers.add(t));
  }

  // Custom tenant-defined triggers (from AI Config page) always included
  (aiConfig.handoffTriggers || []).forEach(t => triggers.add(t));

  return [...triggers];
};

const buildQualifierPrompt = (aiConfig, lead, contact) => `
You are the QUALIFIER AGENT for a sales AI system.

Your ONLY job: analyze the lead's latest message + conversation history and output structured JSON.
You do NOT write replies — the Closer AI handles all responses.

## BUSINESS CONTEXT
${aiConfig.systemPrompt}

## LEAD CONTEXT
- Name: ${contact.name || 'Unknown'}
- Pipeline stage: ${lead.stage}
- Previous score: ${lead.aiScore}/100

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
`;

const runQualifier = async ({ aiConfig, lead, contact, messageHistory, newMessage }) => {
  const t0 = Date.now();
  const system = buildQualifierPrompt(aiConfig, lead, contact);

  const history = (messageHistory || []).slice(-15).map(m => ({
    role: m.sender === 'CONTACT' ? 'user' : 'assistant',
    content: m.content || '[media]',
  }));
  history.push({ role: 'user', content: newMessage });

  let raw = '';
  let tokens = 0;

  try {
    const resp = await client.messages.create({
      model: QUALIFIER_MODEL,
      max_tokens: 256,
      temperature: 0,                   // deterministic — this is analysis
      system,
      messages: history,
    });
    raw = resp.content[0]?.text || '';
    tokens = (resp.usage?.input_tokens || 0) + (resp.usage?.output_tokens || 0);
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
    next_action:           String(parsed.next_action || 'continue_qualifying').slice(0, 100),
    is_enrollment_confirmed: parsed.is_enrollment_confirmed === true,
    is_price_objection: parsed.is_price_objection === true,
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
  "knowledge_gap": "<ONLY if the lead asked a course-specific factual question (batch dates, payment options, specific modules, refund policy) that is NOT in PRODUCT CONTEXT and you could not answer it. General AI/tech questions you can answer from your own knowledge do NOT count. Leave '' if answered or not applicable>"
}

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

const buildCloserPrompt = (aiConfig, lead, contact, qualifierOutput, messageCount, resolvedQAs = []) => `
You are an elite AI Sales Closer specializing in converting WhatsApp leads into paid course enrollments.

Your ONLY job: generate ONE perfectly-calibrated reply that moves this specific lead one step closer to enrolling.
Output structured JSON. No explanations outside the JSON.

═══════════════════════════════════════════════════════
PRODUCT & BUSINESS CONTEXT (your source of truth)
═══════════════════════════════════════════════════════
${aiConfig.systemPrompt}${resolvedQAs.length > 0 ? `

── ADDITIONAL KNOWLEDGE BASE (admin-verified answers) ──
The following Q&As have been answered by the business owner. Use them exactly as written when relevant.
${resolvedQAs.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join('\n\n')}` : ''}

${aiConfig.closingScript ? `ADDITIONAL CLOSING GUIDANCE:\n${aiConfig.closingScript}` : ''}

═══════════════════════════════════════════════════════
QUALIFIER INTELLIGENCE (upstream analysis)
═══════════════════════════════════════════════════════
Temperature : ${qualifierOutput.lead_status}   Score: ${qualifierOutput.score}/10   Intent: ${qualifierOutput.intent}
Lead's situation: ${qualifierOutput.problem_summary}
Recommended next move: ${qualifierOutput.next_action}
Messages exchanged so far: ${messageCount}
${qualifierOutput.is_price_objection ? '⚠️  PRICE OBJECTION DETECTED — deploy the objection playbook immediately. Do NOT skip to close. Handle the concern, then pivot.' : ''}

CONTACT
Name: ${contact.name || 'Unknown'} | Pipeline stage: ${lead.stage}

═══════════════════════════════════════════════════════
YOUR 3-PHASE SALES PLAYBOOK  (match phase to score)
═══════════════════════════════════════════════════════

── PHASE 1 · QUALIFY & SPARK CURIOSITY  (score 1–4, messages 1–3) ──
Goal: discover their pain / desire. Ask ONE question. Do NOT pitch. Do NOT mention price yet.
Tone: friendly, curious, helpful.
Questions that open conversations:
  → "AI se kya achieve karna chahte hain — income, job, ya business automation?"
  → "Kya pehle koi AI tool use kiya hai?"
  → "Freelancing karte hain ya job ki talash mein hain?"
Every reply in Phase 1 MUST end with a question.

── PHASE 2 · PRESENT VALUE & BUILD DESIRE  (score 5–7, messages 4–8) ──
Goal: map their specific goal to the course outcome. Create desire. Handle objections.
Lead with OUTCOME not features:
  → "14 din mein apna AI agent build karo jo aap ke liye kaam kare"
  → "Most log AI sirf use karte hain — hum aapko AI se kaam karwana sikhate hain"
  → "Ye sirf course nahi — ye ek earning system hai jahan aap globally kaam pa sakte ho"
One FOMO hook (batch filling / live sessions). Then ask for soft commitment:
  → "Slot secure karna chahte hain next batch ke liye?"

── PHASE 3 · CLOSE — ASK FOR THE SALE  (score 8–10, messages 9+) ──
Goal: remove final friction. State the offer once, clearly. Ask directly.
They already know the product. Stop explaining. Start closing.
  → "Rs. 10,000. 14 din. Certificate milega. Main registration link bhejun?"
  → "Seat almost fill ho rahi hai — aaj confirm karo?"
  → "Ek step baki hai — registration. Kab karna hai?"
Do NOT re-pitch. Just close.

═══════════════════════════════════════════════════════
OBJECTION PLAYBOOK  (deploy instantly when triggered)
═══════════════════════════════════════════════════════
"AI nahi aata"              → "Perfect — ye course beginners ke liye hi bana hai. Zero se shuru hoga"
"Time nahi"                 → "2 weeks. 1-2 ghante daily. Is se zyada ROI wali skill nahi milegi"
"Mehnga hai / 10k zyada"   → "Rs. 10k ek aisi skill ke liye jo dollar income tak le jaye — ye investment hai"
"Sochna hai"               → "Bilkul — main details share karta hun. Next batch ka schedule bhi bhejun?"
"Baad mein karunga"        → "Next batch delay bhi ho sakta hai — pehle ek seat secure kar lete hain"
"Kya guarantee hai"        → "14 din practical hai — aap khud build karo, results saamne honge"
"Recorded hai?"            → "Live + recorded dono — kabhi miss nahi karenge"
"Kya ye beginners ke liye" → "100% — zero se le ke earning tak, step by step"

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
      → Use your full training knowledge. Answer confidently and well. Then pivot to course.
      Do NOT flag general AI questions as knowledge_gap — you know this already.
7. FEE QUESTIONS are NORMAL — answer directly ("Rs. 10,000 — 14 din, certificate included"), then close.
8. If lead mentions seeing an ad → validate it ("Haan, bilkul!"), briefly pitch, ask one qualifying question.
9. Urgency is ONLY valid when grounded in real facts from PRODUCT CONTEXT.
10. NEVER invent course-specific facts not in PRODUCT CONTEXT (dates, guarantees, partner names, etc.).

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════
${CLOSER_SCHEMA}
`;

const runCloser = async ({ aiConfig, lead, contact, messageHistory, newMessage, qualifierOutput, resolvedQAs = [] }) => {
  const t0 = Date.now();
  const messageCount = (messageHistory || []).length;
  const system = buildCloserPrompt(aiConfig, lead, contact, qualifierOutput, messageCount, resolvedQAs);

  const history = (messageHistory || []).slice(-20).map(m => ({
    role: m.sender === 'CONTACT' ? 'user' : 'assistant',
    content: m.content || '[media]',
  }));
  history.push({ role: 'user', content: newMessage });

  let raw = '';
  let tokens = 0;

  try {
    const resp = await client.messages.create({
      model: CLOSER_MODEL,
      max_tokens: aiConfig.maxTokens || 512,
      temperature: aiConfig.temperature ?? 0.4,
      system,
      messages: history,
    });
    raw = resp.content[0]?.text || '';
    tokens = (resp.usage?.input_tokens || 0) + (resp.usage?.output_tokens || 0);
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

  const result = {
    reply_message:   String(parsed.reply_message || '').slice(0, 1000),
    closing_type:    ['soft','hard','urgent','lost'].includes(parsed.closing_type) ? parsed.closing_type : 'soft',
    urgency_trigger: String(parsed.urgency_trigger || '').slice(0, 200),
    knowledge_gap:   String(parsed.knowledge_gap || '').trim().slice(0, 500),
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
  if (qualifierOutput.next_action === 'close_deal')      target = 'CLOSED_WON';
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

const processMessage = async ({ tenantId, lead, contact, conversation, newMessage, messageHistory, handedBackToAI = false }) => {
  const aiConfig = await prisma.aiConfig.findUnique({ where: { tenantId } });
  if (!aiConfig) throw new Error(`No AI config found for tenant ${tenantId}`);

  // ── 1. QUALIFIER ────────────────────────────────────────────
  let qualifierOutput;
  try {
    qualifierOutput = await runQualifier({ aiConfig, lead, contact, messageHistory, newMessage });
  } catch (err) {
    // Hard fallback — hand off to human, no Closer call
    logger.error({ err, leadId: lead.id }, 'Qualifier failed — handing off');
    return {
      reply: null,
      action: 'handoff',
      handoffReason: `Qualifier AI failed: ${err.message}`,
      leadStatus: lead.scoreLabel || 'COLD',
      score: Math.round((lead.aiScore || 0) / 10) || 1,
      stage: lead.stage,
      humanFollowupRequired: true,
      qualifierOutput: null,
      closerOutput: null,
      tokensUsed: 0,
      qualifierTokens: 0,
      closerTokens: 0,
      qualifierMs: 0,
      closerMs: 0,
      qualifierModel: QUALIFIER_MODEL,
      closerModel: CLOSER_MODEL,
      errorReason: err.message,
    };
  }

  // ── 2. Single handoff gate — is_enrollment_confirmed is the ONLY trigger ──
  // The Qualifier no longer outputs handoff_human in next_action.
  // Handoff fires ONLY when the lead has explicitly confirmed enrollment.
  // Plus settings-based rules for payment disputes / legal threats.
  const rules = aiConfig.handoffRules || {};
  let rulesHandoff = false;
  let rulesHandoffReason = null;

  // Settings rule: payment disputes / refund requests → always human
  if (rules.payment !== false) {
    const msgLower = (newMessage || '').toLowerCase();
    const paymentDispute = /refund|dispute|charge back|chargeback|payment.*fail|failed.*payment/.test(msgLower);
    if (paymentDispute) {
      rulesHandoff = true;
      rulesHandoffReason = 'Payment dispute detected — human required';
      logger.info({ leadId: lead.id }, '🛡 Rule: payment dispute → handoff');
    }
  }

  // Primary gate: enrollment confirmed — Qualifier sets flag AND message must contain
  // an explicit enrollment phrase (whitelist). Haiku is unreliable for this boolean alone,
  // so code does a final check. Whitelist = only real confirmations pass.
  const ENROLLMENT_WHITELIST = /\b(confirm|register\s*kar|enroll|link\s*bhej|book\s*kar|join\s*kart|sign[\s-]*up|seat\s*book|payment\s*kar|main\s*aa\s*raha|main\s*aa\s*rahi|le\s*raha\s*hun|le\s*rahi\s*hun|kardo|kar\s*do\s*register|haan.*register|register.*haan|yes.*join|join.*yes|i.*want.*to.*join|i.*want.*to.*enroll)\b/i;

  if (qualifierOutput.is_enrollment_confirmed && !ENROLLMENT_WHITELIST.test(newMessage)) {
    logger.info({ leadId: lead.id, msg: newMessage.slice(0, 80) },
      '🛡 Whitelist gate: Qualifier said confirmed but no enrollment phrase found — keeping AI on');
    qualifierOutput.is_enrollment_confirmed = false;
  }

  const enrollmentConfirmed = !handedBackToAI && qualifierOutput.is_enrollment_confirmed === true;
  const forceHandoff = enrollmentConfirmed || rulesHandoff;

  const humanFollowupRequired = qualifierOutput.score >= 8 || qualifierOutput.lead_status === 'HOT';

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
      closerOutput = await runCloser({ aiConfig, lead, contact, messageHistory, newMessage, qualifierOutput, resolvedQAs });
    } catch (err) {
      logger.error({ err, leadId: lead.id }, 'Closer failed — falling back to handoff');
      closerError = err.message;
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
  await prisma.subscription.update({
    where: { tenantId },
    data: { aiTokensUsed: { increment: totalTokens } },
  }).catch(() => {});

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
// SUMMARY (unchanged from v1 — used by Conversations page)
// =====================================================================

const generateSummary = async ({ tenantId, messageHistory }) => {
  const messages = (messageHistory || []).slice(-30).map(m => ({
    role: m.sender === 'CONTACT' ? 'user' : 'assistant',
    content: m.content || '[media]',
  }));

  const response = await client.messages.create({
    model: env.CLAUDE_MODEL,
    max_tokens: 300,
    system: 'You are a CRM assistant. Summarize this sales conversation in 3-5 bullet points. Focus on: lead need, budget signals, objections, and next steps. Respond in the same language as the conversation.',
    messages,
  });

  return response.content[0]?.text || 'Unable to generate summary.';
};

module.exports = {
  processMessage,
  generateSummary,
  // exposed for direct use / testing
  runQualifier,
  runCloser,
};
