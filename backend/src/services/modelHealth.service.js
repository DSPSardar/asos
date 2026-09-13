// src/services/modelHealth.service.js
//
// Weekly probe of every model production depends on (config/models.js): one
// minimal call per distinct model, so a deprecated or retired ID is caught by
// a scheduled job on Monday morning instead of by a lead getting no reply.
//
//   openai chat / responses  → 1-token completion
//   openai transcription / image → GET /v1/models/{id} (no generation possible with 1 token)
//   anthropic chat           → 1-token message (skipped when no ANTHROPIC_API_KEY)
//   elevenlabs tts           → skipped (not an LLM; no cheap probe)
//
// A failure that looks like deprecation (404, "deprecated", "decommissioned",
// "retired", "does not exist") raises a systemAlert to the Mastery tenant's
// admin (WhatsApp → email fallback) and a Sentry message. Other errors
// (rate limit, network) are logged as warnings only.

const Sentry = require('@sentry/node');
const OpenAI = require('openai');
const env = require('../config/env');
const logger = require('../utils/logger');
const redis = require('../config/redis');
const prisma = require('../config/database');
const { listConfiguredModels } = require('../config/models');
const notificationService = require('./notification.service');
const { runWithSystemScope } = require('../middleware/requestContext.middleware');

const EV = 'model-health';
const LAST_KEY = 'model-health:last';
const DEPRECATION_PATTERN = /deprecat|decommission|retired|not found|does not exist|no longer (available|supported)|unknown model|invalid model/i;

const looksDeprecated = (err) => {
  const status = err?.status || err?.statusCode || err?.response?.status;
  if (status === 404) return true;
  return DEPRECATION_PATTERN.test(String(err?.message || err?.error?.message || ''));
};

let openaiClient = null;
const openai = () => {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 0 });
  return openaiClient;
};

let anthropicClient = null;
const anthropic = () => {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 0 });
  }
  return anthropicClient;
};

/** Probe one model. Never throws. */
const probeModel = async ({ provider, kind, id }) => {
  const t0 = Date.now();
  const done = (extra) => ({ provider, kind, id, ms: Date.now() - t0, ...extra });
  try {
    if (provider === 'openai' && kind === 'chat') {
      await openai().chat.completions.create({ model: id, messages: [{ role: 'user', content: 'ping' }], max_completion_tokens: 1 });
      return done({ ok: true, status: 'ok' });
    }
    if (provider === 'openai' && kind === 'responses') {
      // The Responses API floor for max_output_tokens is 16.
      await openai().responses.create({ model: id, input: 'ping', max_output_tokens: 16 });
      return done({ ok: true, status: 'ok' });
    }
    if (provider === 'openai') {
      await openai().models.retrieve(id);
      return done({ ok: true, status: 'ok', probe: 'models.retrieve' });
    }
    if (provider === 'anthropic') {
      const client = anthropic();
      if (!client) return done({ ok: true, status: 'skipped', reason: 'no ANTHROPIC_API_KEY' });
      await client.messages.create({ model: id, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
      return done({ ok: true, status: 'ok' });
    }
    return done({ ok: true, status: 'skipped', reason: `no probe for ${provider}/${kind}` });
  } catch (err) {
    const deprecated = looksDeprecated(err);
    return done({ ok: false, status: deprecated ? 'deprecated' : 'error', deprecated, httpStatus: err?.status || err?.statusCode || null, error: String(err?.message || err).slice(0, 300) });
  }
};

/** Probe every configured model; alert on deprecation. Returns the report. */
const checkAllModels = async ({ alert = true, now = new Date() } = {}) => {
  const models = listConfiguredModels();
  const results = [];
  for (const m of models) {
    const r = await probeModel(m);
    results.push({ ...r, roles: m.roles });
    const level = r.ok ? 'info' : (r.deprecated ? 'error' : 'warn');
    logger[level]({ ev: EV, ...r, roles: m.roles }, `model health: ${m.provider}/${m.id} ${r.status}`);
  }
  const deprecated = results.filter((r) => r.deprecated);
  const report = { ranAt: now.toISOString(), total: results.length, ok: results.filter((r) => r.ok).length, deprecated: deprecated.length, results };
  redis.set(LAST_KEY, JSON.stringify(report), 'EX', 60 * 24 * 3600).catch(() => {});

  if (deprecated.length && alert) {
    const lines = deprecated.map((r) => `• ${r.provider} ${r.id} (${r.roles.join(', ')}): ${r.error}`);
    const reason = `Model deprecation detected — ${deprecated.length} model(s) failed the weekly probe:\n${lines.join('\n')}\n\nUpdate the env override (OPENAI_MODEL / ANTHROPIC_MODEL …) on Railway.`;
    Sentry.captureMessage(`model-health: ${deprecated.length} deprecated model(s)`, { level: 'error', extra: { deprecated } });
    if (env.MASTERY_TENANT_ID) {
      await runWithSystemScope(async () => {
        const tenant = await prisma.tenant.findUnique({ where: { id: env.MASTERY_TENANT_ID } }).catch(() => null);
        if (tenant) await notificationService.notifyAdmin(tenant, 'systemAlert', { reason });
      }).catch((err) => logger.warn({ err }, 'model-health alert failed'));
    }
  }
  return report;
};

module.exports = { checkAllModels, probeModel, looksDeprecated, EV, LAST_KEY };
