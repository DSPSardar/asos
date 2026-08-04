// src/modules/knowledge-gaps/knowledge-gaps.service.js

const prisma = require('../../config/database');
const { cleanQuestion, isSameQuestion } = require('./question-key');

// How many recent gaps to compare a new one against. Fuzzy matching can't be
// pushed into SQL, so it runs in JS over a bounded candidate set.
const DEDUP_CANDIDATE_LIMIT = 300;

// ── List all gaps for a tenant (unanswered first) ────────────────────────────
const listGaps = async (tenantId, { resolved } = {}) => {
  const where = { tenantId };
  if (resolved !== undefined) where.resolved = resolved === 'true' || resolved === true;

  const gaps = await prisma.knowledgeGap.findMany({
    where,
    orderBy: [{ resolved: 'asc' }, { timesAsked: 'desc' }, { createdAt: 'desc' }],
  });

  return { gaps, total: gaps.length };
};

// ── Log a new gap (or increment timesAsked if same question already exists) ──
// The Closer writes `knowledge_gap` in free prose, so the same missing fact
// arrives worded differently every time ("fee amount", "Fee structure is not
// provided in the DSP knowledge base."). Matching on the exact string turned
// every rewording into its own row, which is why the same question kept
// reappearing even after the owner had answered it. Store the boilerplate-free
// question and match on meaning — see ./question-key.js.
const logGap = async (tenantId, { question, exampleLead } = {}) => {
  if (!question?.trim()) return null;

  const q = cleanQuestion(question).slice(0, 500);
  if (!q) return null;

  const candidates = await prisma.knowledgeGap.findMany({
    where: { tenantId },
    orderBy: { updatedAt: 'desc' },
    take: DEDUP_CANDIDATE_LIMIT,
  });

  // Prefer an unanswered match so the counter lands on the row the owner still
  // needs to act on; fall back to an answered one — a question the AI already
  // has an answer for must never come back as a fresh unanswered card.
  const matches = candidates.filter((gap) => isSameQuestion(gap.question, q));
  const existing = matches.find((gap) => !gap.resolved) || matches[0];

  if (existing) {
    return prisma.knowledgeGap.update({
      where: { id: existing.id },
      data: { timesAsked: { increment: 1 }, exampleLead: exampleLead || existing.exampleLead },
    });
  }

  return prisma.knowledgeGap.create({
    data: { tenantId, question: q, exampleLead: exampleLead || null },
  });
};

// ── Admin answers a gap → marks resolved ─────────────────────────────────────
const answerGap = async (tenantId, gapId, { answer }) => {
  if (!answer?.trim()) throw Object.assign(new Error('Answer is required'), { statusCode: 400 });

  const gap = await prisma.knowledgeGap.findFirst({ where: { id: gapId, tenantId } });
  if (!gap) throw Object.assign(new Error('Knowledge gap not found'), { statusCode: 404 });

  return prisma.knowledgeGap.update({
    where: { id: gapId },
    data: { answer: answer.trim(), resolved: true },
  });
};

// ── Delete a gap ──────────────────────────────────────────────────────────────
const deleteGap = async (tenantId, gapId) => {
  const gap = await prisma.knowledgeGap.findFirst({ where: { id: gapId, tenantId } });
  if (!gap) throw Object.assign(new Error('Knowledge gap not found'), { statusCode: 404 });
  await prisma.knowledgeGap.delete({ where: { id: gapId } });
  return { deleted: true };
};

// ── Get resolved Q&As formatted for system prompt injection ──────────────────
const getResolvedQAs = async (tenantId) => {
  const gaps = await prisma.knowledgeGap.findMany({
    where: { tenantId, resolved: true },
    select: { question: true, answer: true },
    orderBy: { updatedAt: 'desc' },
    take: 50, // cap at 50 to avoid bloating prompt
  });

  // Rows logged before question cleaning still read "X is not provided in the
  // DSP knowledge base." Feeding that phrasing back to the Closer as a Q&A is
  // actively confusing — it reads as confirmation that the fact is missing.
  // Normalize on the way out so old and new rows look the same in the prompt.
  return gaps.map((gap) => ({ ...gap, question: cleanQuestion(gap.question) }));
};

module.exports = { listGaps, logGap, answerGap, deleteGap, getResolvedQAs };
