// src/services/insightsBackfill.service.js
// One-time (idempotent) backfill: classify recent inbound messages that
// predate the sentiment/signal pipeline so the AI Insights charts aren't
// empty on day one. Runs on worker boot, in the background, batched.
//
// Idempotency: only touches messages with sentiment IS NULL in the last
// 7 days; once classified they never match again, so subsequent boots
// find ~nothing and exit immediately.

const prisma = require('../config/database');
const logger = require('../utils/logger');
const { runWithSystemScope } = require('../middleware/requestContext.middleware');
const OpenAI = require('openai');
const env = require('../config/env');

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const MODEL = env.OPENAI_QUALIFIER_MODEL || env.OPENAI_MODEL;

const BATCH_SIZE = 25;      // messages per AI call
const MAX_MESSAGES = 2000;  // hard cost cap per boot
const BATCH_DELAY_MS = 1500;

const SENTIMENTS   = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'];
const SIGNAL_TYPES = ['PRICING', 'INSTALLMENT', 'BATCH', 'CAREER', 'PAYMENT',
  'TRACK_RECORD', 'CONSULTATION', 'CORPORATE', 'ENROLLMENT', 'RISK', 'NONE'];

const INSTRUCTIONS = `You classify WhatsApp messages from sales leads (course/bootcamp inquiries, often Roman Urdu / Urdu / English mixed).
For EACH message return sentiment and signal_type.

sentiment: "POSITIVE" (enthusiasm, agreement, gratitude, readiness) | "NEGATIVE" (frustration, complaint, refusal, distrust) | "NEUTRAL" (questions, facts, greetings, everything else)

signal_type (dominant intent): "PRICING" fee/cost/discount | "INSTALLMENT" payment plan | "BATCH" schedule/dates | "CAREER" jobs/freelancing outcomes | "PAYMENT" payment sent/proof/confirmation | "TRACK_RECORD" trainer credentials/certificates | "CONSULTATION" call/meeting ask | "CORPORATE" team/company training | "ENROLLMENT" ready to enroll/pay | "RISK" objection threatening the deal | "NONE" greetings/small talk/other

Respond with ONLY valid JSON: {"results":[{"id":"<id>","sentiment":"...","signal_type":"..."}]} — one entry per input message, same ids.`;

const classifyBatch = async (messages) => {
  const input = messages.map((m) => ({ id: m.id, text: (m.content || '').slice(0, 300) }));
  const resp = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: INSTRUCTIONS },
      { role: 'user', content: JSON.stringify({ messages: input }) },
    ],
  });
  const raw = resp.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.results) ? parsed.results : [];
};

const runInsightsBackfill = () => runWithSystemScope(async () => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const pending = await prisma.message.findMany({
    where: {
      direction: 'INBOUND',
      sentiment: null,
      sentAt: { gte: since },
      type: 'TEXT',
      content: { not: null },
    },
    orderBy: { sentAt: 'desc' },
    take: MAX_MESSAGES,
    select: { id: true, content: true },
  });

  if (pending.length === 0) {
    logger.info('📊 Insights backfill: nothing to classify');
    return { classified: 0 };
  }
  logger.info({ count: pending.length, model: MODEL }, '📊 Insights backfill starting');

  let classified = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    try {
      const results = await classifyBatch(batch);
      const byId = new Map(results.map((r) => [String(r.id), r]));
      await Promise.all(batch.map((m) => {
        const r = byId.get(m.id);
        if (!r) return null;
        const sentiment = SENTIMENTS.includes(r.sentiment) ? r.sentiment : 'NEUTRAL';
        const st = SIGNAL_TYPES.includes(r.signal_type) ? r.signal_type : 'NONE';
        return prisma.message.update({
          where: { id: m.id },
          data: { sentiment, signalType: st === 'NONE' ? null : st },
        }).then(() => { classified += 1; }).catch(() => {});
      }));
    } catch (err) {
      logger.warn({ err, batchStart: i }, '📊 Insights backfill batch failed — continuing');
    }
    if (i + BATCH_SIZE < pending.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  logger.info({ classified, of: pending.length }, '📊 Insights backfill complete');
  return { classified };
});

module.exports = { runInsightsBackfill };
