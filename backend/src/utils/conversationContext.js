// src/utils/conversationContext.js
// What conversation history an AI turn gets to see — shared by the worker
// and the backlog sweep so both build the same context.
//
// Before this, the worker loaded EVERY message of the thread on every turn,
// then the agents kept only the last 15/20 and everything older was simply
// forgotten. Now:
//   - only a bounded window is fetched (WINDOW newest messages);
//   - older messages are collapsed into a rolling summary stored on the lead
//     (historySummary*), refreshed after the reply once ≥ SUMMARY_REFRESH_EVERY
//     un-summarized messages have fallen out of the window;
//   - when a summary exists the window starts exactly where the summary ends
//     (never fewer than WINDOW messages), so no message is ever in neither.
//
// Message indexes ("historySummaryCount") are positions in the thread's
// history as the AI sees it: oldest first, outbound voice-note twins
// excluded (each is just the audio copy of the text reply before it).

const prisma = require('../config/database');
const logger = require('./logger');
const { sanitizeHistoryForAI } = require('./aiHistory');

const WINDOW = 20;
const SUMMARY_REFRESH_EVERY = 10;

const HISTORY_SELECT = { id: true, sender: true, content: true, sentAt: true, type: true, direction: true, sentiment: true };

const historyWhere = (tenantId, conversationId, excludeMessageId) => ({
  conversationId,
  tenantId,
  NOT: { type: 'AUDIO', direction: 'OUTBOUND' },
  ...(excludeMessageId ? { id: { not: excludeMessageId } } : {}),
});

// A lead's summary only applies to the conversation it was written for.
const summaryFor = (lead, conversationId) => (
  lead?.historySummary && lead.historySummaryConversationId === conversationId
    ? { text: lead.historySummary, count: lead.historySummaryCount || 0 }
    : null
);

/**
 * @returns {{ messageHistory: object[], contactMessageCount: number, earlierSummary: string|null }}
 *   messageHistory — oldest→newest, payment details redacted
 *   contactMessageCount — the lead's messages in the WHOLE thread (the
 *     Closer's phase logic counts these; the window must not shrink it)
 */
const loadConversationContext = async ({ tenantId, conversationId, lead, excludeMessageId = null, paymentDetails = null, window = WINDOW }) => {
  const where = historyWhere(tenantId, conversationId, excludeMessageId);
  const summary = summaryFor(lead, conversationId);

  const [total, contactMessageCount] = await Promise.all([
    summary ? prisma.message.count({ where }) : Promise.resolve(0),
    prisma.message.count({ where: { ...where, sender: 'CONTACT' } }),
  ]);
  const take = summary ? Math.max(window, total - summary.count) : window;

  const newestFirst = await prisma.message.findMany({ where, orderBy: { sentAt: 'desc' }, take, select: HISTORY_SELECT });
  return {
    messageHistory: sanitizeHistoryForAI(newestFirst.reverse(), paymentDetails),
    contactMessageCount,
    earlierSummary: summary?.text || null,
  };
};

const defaultSummarize = (args) => require('../services/claude.service').generateSummary({ ...args, rolling: true });

/**
 * Fold messages that have left the window into the lead's rolling summary,
 * once enough have piled up. Runs AFTER the reply went out — never on the
 * reply's critical path — and never throws.
 * @returns {Promise<boolean>} true when the summary was refreshed
 */
const refreshSummaryIfDue = async ({ tenantId, conversationId, lead, paymentDetails = null, summarize = defaultSummarize, window = WINDOW, every = SUMMARY_REFRESH_EVERY }) => {
  try {
    const where = historyWhere(tenantId, conversationId, null);
    const summary = summaryFor(lead, conversationId);
    const summarized = summary?.count || 0;
    const target = (await prisma.message.count({ where })) - window;
    if (target - summarized < every) return false;

    const fresh = await prisma.message.findMany({
      where, orderBy: { sentAt: 'asc' }, skip: summarized, take: target - summarized, select: HISTORY_SELECT,
    });
    const text = await summarize({
      tenantId,
      messageHistory: sanitizeHistoryForAI(fresh, paymentDetails),
      priorSummary: summary?.text || null,
    });
    if (!text) return false;

    // Guarded on the count we started from: a concurrent refresh that got
    // there first wins and this one is dropped rather than overwriting it.
    const { count } = await prisma.lead.updateMany({
      where: { id: lead.id, tenantId, historySummaryCount: lead.historySummaryCount || 0 },
      data: { historySummary: text, historySummaryCount: target, historySummaryConversationId: conversationId, historySummaryAt: new Date() },
    });
    if (count) {
      Object.assign(lead, { historySummary: text, historySummaryCount: target, historySummaryConversationId: conversationId });
      logger.info({ leadId: lead.id, conversationId, summarizedThrough: target }, '🗜  Rolling history summary refreshed');
    }
    return count > 0;
  } catch (err) {
    logger.warn({ err, leadId: lead?.id, conversationId }, 'Rolling history summary refresh failed (non-blocking)');
    return false;
  }
};

module.exports = { WINDOW, SUMMARY_REFRESH_EVERY, loadConversationContext, refreshSummaryIfDue };
