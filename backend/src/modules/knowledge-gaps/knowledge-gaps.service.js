// src/modules/knowledge-gaps/knowledge-gaps.service.js

const prisma = require('../../config/database');

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
const logGap = async (tenantId, { question, exampleLead } = {}) => {
  if (!question?.trim()) return null;

  const q = question.trim().slice(0, 500);

  // Fuzzy dedup: if the same question (case-insensitive) already exists, just bump the counter
  const existing = await prisma.knowledgeGap.findFirst({
    where: {
      tenantId,
      question: { equals: q, mode: 'insensitive' },
    },
  });

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
  return gaps;
};

module.exports = { listGaps, logGap, answerGap, deleteGap, getResolvedQAs };
