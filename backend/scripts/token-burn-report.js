#!/usr/bin/env node
// scripts/token-burn-report.js
//
// Tokens per AI reply, before vs after the bounded-context + prompt-caching
// change, on the longest threads of one tenant. READ-ONLY: no message is
// sent, no row is written, and the subscription counter is never touched.
//
//   node scripts/token-burn-report.js [--tenant <id>] [--threads 3] [--turns 5] [--live]
//
// Columns
//   logged/reply      mean qualifier+closer tokens actually billed per reply,
//                     from ai_agent_logs (the real "before")
//   old in / new in   input tokens (qualifier + closer prompts) for the same
//                     turns replayed through the OLD context (full history,
//                     15/20 slice) and the NEW one (window + rolling summary),
//                     counted with o200k_base — no API calls
//   --live            additionally makes 3 real qualifier+closer calls per
//                     thread with the NEW prompts (and one rolling-summary
//                     call) to observe prompt_tokens_details.cached_tokens, and
//                     reports metered tokens/reply = uncached + 10% cached +
//                     output. Costs a few cents; still writes nothing.
//
// Raw message content never leaves this process; only aggregates print.
// Every query selects pre-existing columns explicitly, so the script runs
// against a database that hasn't applied this branch's migrations yet.
'use strict';

require('dotenv').config();
const { getEncoding } = require('js-tiktoken');
const prisma = require('../src/config/database');
const { requestContext, runWithSystemScope } = require('../src/middleware/requestContext.middleware');
const claude = require('../src/services/claude.service');
const { sanitizeHistoryForAI } = require('../src/utils/aiHistory');
const { WINDOW } = require('../src/utils/conversationContext');

const DSP = '87bfa1b0-1774-4278-b630-d30836cf4183';
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const TENANT = arg('tenant', DSP);
const THREADS = Number(arg('threads', 3));
const TURNS = Number(arg('turns', 5));
const LIVE = process.argv.includes('--live');
const LIVE_CALLS = 3;

const enc = getEncoding('o200k_base');
const tok = (msgs) => msgs.reduce((n, m) => n + enc.encode(String(m.content || '')).length + 4, 0);
const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const { buildQualifierPrompt, buildCloserPrompt, toChatHistory, createResponse, QUALIFIER_MODEL, CLOSER_MODEL } = claude._internals;

// A stand-in rolling summary for the offline count (~150 words, the cap the
// summarizer is instructed to stay under). --live replaces it with a real one.
const PLACEHOLDER_SUMMARY = 'word '.repeat(150).trim();
const QUAL_STUB = { lead_status: 'WARM', score: 6, intent: 'medium', problem_summary: 'x'.repeat(120), next_action: 'continue_qualifying', is_price_objection: false };

const promptsFor = ({ aiConfig, lead, contact, history, summary, contactCount, newMessage, old }) => {
  const qSys = buildQualifierPrompt(aiConfig, lead, contact);
  const cSys = buildCloserPrompt(aiConfig, lead, contact, QUAL_STUB, contactCount + 1, [], false, false, lead.language);
  const q = [{ role: 'system', content: qSys }, ...toChatHistory(history, 15, old ? null : summary, newMessage)];
  const c = [{ role: 'system', content: cSys }, ...toChatHistory(history, 20, old ? null : summary, newMessage)];
  return { q, c };
};

const threadReport = async (conversationId, aiConfig) => {
  // Explicit selects of pre-existing columns only: this script must run
  // against a database that has NOT yet applied this branch's migrations
  // (e.g. prod before merge), so it never asks for leads.history_summary*
  // or ai_agent_logs.*_cached_tokens.
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId: TENANT },
    select: {
      id: true,
      lead: { select: { id: true, stage: true, aiScore: true, language: true } },
      contact: { select: { id: true, name: true } },
    },
  });
  const all = sanitizeHistoryForAI((await prisma.message.findMany({
    where: { conversationId, tenantId: TENANT, NOT: { type: 'AUDIO', direction: 'OUTBOUND' } },
    orderBy: { sentAt: 'asc' },
    select: { id: true, sender: true, content: true, sentAt: true },
  })), aiConfig.paymentDetails);

  const logs = await prisma.aiAgentLog.findMany({
    where: { conversationId, tenantId: TENANT },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { qualifierTokens: true, closerTokens: true },
  });

  // Replay the last TURNS inbound messages.
  const idx = all.map((m, i) => (m.sender === 'CONTACT' ? i : -1)).filter((i) => i > 0).slice(-TURNS);
  const oldIn = [];
  const newIn = [];
  const turnsForLive = [];
  for (const i of idx) {
    const before = all.slice(0, i);
    const contactCount = before.filter((m) => m.sender === 'CONTACT').length;
    const newMessage = all[i].content || '[media]';
    const o = promptsFor({ aiConfig, lead: conv.lead, contact: conv.contact, history: before, contactCount, newMessage, old: true });
    // New context: summary covers everything older than the window.
    const hasSummary = before.length > WINDOW;
    const history = hasSummary ? before.slice(-WINDOW) : before;
    const n = promptsFor({ aiConfig, lead: conv.lead, contact: conv.contact, history, summary: hasSummary ? PLACEHOLDER_SUMMARY : null, contactCount, newMessage, old: false });
    oldIn.push(tok(o.q) + tok(o.c));
    newIn.push(tok(n.q) + tok(n.c));
    turnsForLive.push({ before, history, hasSummary, contactCount, newMessage });
  }

  const row = {
    messages: all.length,
    replies: logs.length,
    loggedPerReply: mean(logs.map((l) => l.qualifierTokens + l.closerTokens)),
    oldInPerReply: mean(oldIn),
    newInPerReply: mean(newIn),
  };

  if (LIVE && turnsForLive.length) {
    const metered = [];
    const cachedShare = [];
    // One real rolling summary for this thread (tenantId omitted → nothing metered).
    const last = turnsForLive.at(-1);
    const summary = last.hasSummary
      ? await claude.generateSummary({ messageHistory: last.before.slice(0, -WINDOW), rolling: true })
      : null;
    for (let k = 0; k < LIVE_CALLS; k += 1) {
      const t = turnsForLive[Math.max(0, turnsForLive.length - LIVE_CALLS + k)];
      const p = promptsFor({ aiConfig, lead: conv.lead, contact: conv.contact, history: t.history, summary, contactCount: t.contactCount, newMessage: t.newMessage, old: false });
      let m = 0; let cached = 0; let prompt = 0;
      for (const [agent, msgs, model] of [['qualifier', p.q, QUALIFIER_MODEL], ['closer', p.c, CLOSER_MODEL]]) {
        const resp = await createResponse({ model, maxOutputTokens: 600, instructions: msgs[0].content, input: msgs.slice(1), jsonMode: true, cacheKey: `asos:${TENANT}:${agent}` });
        m += claude.meteredTokens(resp.usage);
        cached += resp.usage?.prompt_tokens_details?.cached_tokens || 0;
        prompt += resp.usage?.prompt_tokens || 0;
      }
      metered.push(m);
      cachedShare.push(prompt ? Math.round((cached / prompt) * 100) : 0);
    }
    row.liveMeteredPerReply = mean(metered);
    row.liveCachedPct = cachedShare;
  }
  return row;
};

const main = () => runWithSystemScope(async () => {
  const top = await prisma.message.groupBy({
    by: ['conversationId'],
    where: { tenantId: TENANT },
    _count: { _all: true },
    orderBy: { _count: { conversationId: 'desc' } },
    take: THREADS,
  });
  return requestContext.run({ tenantId: TENANT }, async () => {
    const aiConfig = await prisma.aiConfig.findUnique({
      where: { tenantId: TENANT },
      select: { systemPrompt: true, closingScript: true, paymentDetails: true },
    });
    const rows = [];
    for (const [i, t] of top.entries()) {
      rows.push({ thread: `#${i + 1}`, ...(await threadReport(t.conversationId, aiConfig)) });
    }
    console.table(rows);
    console.log(JSON.stringify({ tenant: TENANT, window: WINDOW, turns: TURNS, live: LIVE, rows }, null, 2));
  });
});

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
