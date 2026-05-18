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
  "next_action": "<what should happen next: 'continue_qualifying' | 'send_proposal' | 'close_deal' | 'handoff_human' | 'nurture'>"
}

SCORING RULES:
  • 8-10  HOT   — strong buying intent, clear need, urgency, decision authority
  • 5-7   WARM  — interested, asking questions, missing 1+ BANT element
  • 1-4   COLD  — casual browsing, unclear, off-topic, or unqualified
`;

const buildQualifierPrompt = (aiConfig, lead, contact) => `
You are the QUALIFIER AGENT for a B2B sales operating system.

Your ONLY job: analyze the latest contact message + history, then output structured JSON.
You do NOT write replies. Another agent (Closer) handles that.

## TENANT BUSINESS CONTEXT
${aiConfig.systemPrompt}

## QUALIFICATION CRITERIA TO LOOK FOR
${(aiConfig.qualificationCriteria || []).map(c => '- ' + c).join('\n')}

## HANDOFF TRIGGERS (force next_action="handoff_human")
${JSON.stringify(aiConfig.handoffTriggers || ['urgent','angry','refund','legal','complaint'])}

## LEAD CONTEXT
- Contact name: ${contact.name || 'Unknown'}
- Current stage: ${lead.stage}
- Previous score: ${lead.aiScore}/100
- Prior qualification data: ${JSON.stringify(lead.qualificationData || {})}

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
    lead_status:     ['HOT','WARM','COLD'].includes(parsed.lead_status) ? parsed.lead_status : 'COLD',
    score:           Math.min(10, Math.max(1, parseInt(parsed.score) || 1)),
    intent:          ['high','medium','low'].includes(parsed.intent) ? parsed.intent : 'low',
    problem_summary: String(parsed.problem_summary || '').slice(0, 500),
    next_action:     String(parsed.next_action || 'continue_qualifying').slice(0, 100),
    _tokens:         tokens,
    _model:          QUALIFIER_MODEL,
    _ms:             Date.now() - t0,
  };

  logger.info({ leadId: lead.id, ...result }, '🎯 Qualifier output');
  return result;
};

// =====================================================================
// CLOSER AI
// =====================================================================

const CLOSER_SCHEMA = `
Respond with ONLY a valid JSON object using this EXACT schema. No prose, no markdown.

{
  "reply_message": "<the WhatsApp reply to send — short, conversational, persuasive, max 280 chars>",
  "closing_type": "soft" | "hard" | "urgent",
  "urgency_trigger": "<specific reason to act now: limited spots, deadline, price increase, etc.>"
}

CLOSING TYPES:
  • soft    — gentle nudge, ask a question, build rapport
  • hard    — direct ask: "ready to start?" / "shall we send the proposal?"
  • urgent  — time/scarcity pressure: "only 3 spots left this week"
`;

const buildCloserPrompt = (aiConfig, lead, contact, qualifierOutput) => `
You are the CLOSER AGENT for a B2B sales operating system.

Your ONLY job: generate ONE persuasive WhatsApp reply, calibrated to the
Qualifier's analysis. Output structured JSON.

## TENANT BUSINESS + VOICE
${aiConfig.systemPrompt}

## CLOSING SCRIPT GUIDANCE
${aiConfig.closingScript || 'When the lead shows buying intent, present a clear CTA and offer to schedule a consultation call or share the payment process.'}

## QUALIFIER ANALYSIS (from upstream agent)
- Lead status: ${qualifierOutput.lead_status}
- Score: ${qualifierOutput.score}/10
- Intent: ${qualifierOutput.intent}
- Problem: ${qualifierOutput.problem_summary}
- Recommended next action: ${qualifierOutput.next_action}

## CONTACT
- Name: ${contact.name || 'Unknown'}
- Stage: ${lead.stage}

## STYLE RULES (NON-NEGOTIABLE)
- Short. Conversational. Human. Never robotic. WhatsApp length — 1 to 3 short lines.
- Language: Pakistani urban professional Urdu+English mix (Roman Urdu is fine).
  Mirror the lead — if they write in English, lean English; if they mix, mix back; if pure Roman Urdu, reply in Roman Urdu.
- Address the lead respectfully: "sir" / "madam" / "bhai" / "ji" depending on cues
  in their messages. Default to "sir" / "madam" if unsure.
- One subtle urgency hook when score >= 7 — but ONLY if the urgency is grounded
  in a fact already present in TENANT BUSINESS + VOICE. Never fabricate scarcity,
  deadlines, or "limited spots".
- Never be pushy on COLD leads — build rapport, ask one open question.
- No emoji spam — at most one, only when it fits the brand voice.

## FACTS — STRICT RULE
ONLY reference facts that appear in the TENANT BUSINESS + VOICE block above.
If the lead asks something not covered there (specific dividend %, certifications,
SLA, religious certifications, exact unit availability, anything you don't see
in the system prompt), DO NOT invent. Instead, say you'll connect them with the
team for accurate details, and offer the consultation call.

## CLOSER GOALS (priority order)
1. Address the lead's most recent objection or question, using only facts from
   the system prompt.
2. If WARM (5–7) or HOT (8–10) and a consultation hasn't been offered yet, offer
   one — frame it as a no-pressure call to walk through the project.
3. If the lead asks about payment / process / next steps, walk them through it
   clearly using only documented details (downpayment terms, installment plan,
   unit options) that appear in the system prompt.
4. Pick closing_type: soft (score 1–4 or new lead), hard (score 5–7 with clear
   intent), urgent (score 8–10 with a real fact-based time/scarcity hook).

## OUTPUT FORMAT
${CLOSER_SCHEMA}
`;

const runCloser = async ({ aiConfig, lead, contact, messageHistory, newMessage, qualifierOutput }) => {
  const t0 = Date.now();
  const system = buildCloserPrompt(aiConfig, lead, contact, qualifierOutput);

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
    closing_type:    ['soft','hard','urgent'].includes(parsed.closing_type) ? parsed.closing_type : 'soft',
    urgency_trigger: String(parsed.urgency_trigger || '').slice(0, 200),
    _tokens:         tokens,
    _model:          CLOSER_MODEL,
    _ms:             Date.now() - t0,
  };

  logger.info({ leadId: lead.id, closing_type: result.closing_type }, '💬 Closer output');
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

  // ── 2. Routing decisions from Qualifier alone ──────────────
  const humanFollowupRequired = qualifierOutput.score >= 8 || qualifierOutput.lead_status === 'HOT';
  // If a human agent deliberately handed this conversation back to AI, suppress
  // auto-handoff so Claude gets a chance to continue. The agent can still
  // manually take over again at any time.
  const forceHandoff = !handedBackToAI && qualifierOutput.next_action === 'handoff_human';

  // ── 3. CLOSER ───────────────────────────────────────────────
  let closerOutput = null;
  let closerError = null;
  if (!forceHandoff) {
    try {
      closerOutput = await runCloser({ aiConfig, lead, contact, messageHistory, newMessage, qualifierOutput });
    } catch (err) {
      logger.error({ err, leadId: lead.id }, 'Closer failed — falling back to handoff');
      closerError = err.message;
    }
  }

  // ── 4. Determine final action ───────────────────────────────
  let action = 'continue';
  let handoffReason = null;

  if (forceHandoff) {
    action = 'handoff';
    handoffReason = `Qualifier flagged handoff (intent=${qualifierOutput.intent}, action=${qualifierOutput.next_action})`;
  } else if (closerError) {
    action = 'handoff';
    handoffReason = `Closer AI failed: ${closerError}`;
  } else if (qualifierOutput.next_action === 'close_deal') {
    action = 'close';
  }

  // ── 5. Map qualifier 1-10 score → DB 0-100 + derive stage ──
  const stage    = deriveStage(lead.stage, qualifierOutput);
  const aiScore  = qualifierOutput.score * 10;
  const reply    = closerOutput?.reply_message || null;

  // ── 6. Log to AiAgentLog (audit trail for Analyst AI v2) ────
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

  // ── 7. Update token usage for billing ───────────────────────
  const totalTokens = (qualifierOutput._tokens || 0) + (closerOutput?._tokens || 0);
  await prisma.subscription.update({
    where: { tenantId },
    data: { aiTokensUsed: { increment: totalTokens } },
  }).catch(() => {});

  // ── 8. Return v1-compatible shape (+ v1.5 extras) ───────────
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
