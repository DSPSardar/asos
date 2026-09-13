// src/config/models.js
//
// The ONE place a model ID may be written down. Every service reads its model
// (and the per-model request parameters) from here, so a deprecated ID is a
// one-line change and the weekly health check (services/modelHealth.service.js)
// knows exactly which models production depends on.
//
// Env overrides (all optional, validated in config/env.js):
//   OPENAI_MODEL / OPENAI_QUALIFIER_MODEL / OPENAI_CLOSER_MODEL
//   OPENAI_TRANSCRIPTION_MODEL / OPENAI_IMAGE_MODEL
//   ANTHROPIC_MODEL (alias: CLAUDE_MODEL, CLOSER_MODEL) — Content Studio copy
//   QUALIFIER_MODEL                                     — Content Studio brand analysis
//   ELEVENLABS_MODEL_ID
//
// Never import a provider SDK here — this file must stay requirable from
// tests and from the API without side effects.

const env = require('./env');

const pick = (...candidates) => candidates.find((v) => typeof v === 'string' && v.trim() !== '') || null;

// ── Defaults (used only when no env override is set) ─────────────────
const DEFAULTS = {
  openaiChat:          'gpt-5.4-mini',
  openaiTranscription: 'whisper-1',
  openaiImage:         'gpt-image-1',
  anthropicAnalysis:   'claude-haiku-4-5',
  anthropicCopy:       'claude-sonnet-5',
  elevenlabsTts:       'eleven_multilingual_v2',
};

const openaiChat = pick(env.OPENAI_MODEL, DEFAULTS.openaiChat);

const MODELS = {
  // WhatsApp sales agent (services/claude.service.js — OpenAI SDK despite the name)
  qualifier: {
    provider: 'openai', kind: 'chat',
    id: pick(env.OPENAI_QUALIFIER_MODEL, openaiChat),
    params: { maxOutputTokens: 512, jsonMode: true },
  },
  closer: {
    provider: 'openai', kind: 'chat',
    id: pick(env.OPENAI_CLOSER_MODEL, openaiChat),
    params: { maxOutputTokens: 1024, jsonMode: true },
  },
  // Enrolled-student support persona — same model as the Closer.
  support: {
    provider: 'openai', kind: 'chat',
    id: pick(env.OPENAI_CLOSER_MODEL, openaiChat),
    params: { maxOutputTokens: 400, jsonMode: true },
  },
  // Conversation summary (/conversations/:id/summary)
  summary: {
    provider: 'openai', kind: 'chat',
    id: openaiChat,
    params: { maxOutputTokens: 300 },
  },
  // Payment-proof screenshot classification (vision)
  paymentProofVision: {
    provider: 'openai', kind: 'chat',
    id: openaiChat,
    params: { maxOutputTokens: 120 },
  },
  // Sentiment/signal backfill (services/insightsBackfill.service.js)
  insightsClassifier: {
    provider: 'openai', kind: 'chat',
    id: pick(env.OPENAI_QUALIFIER_MODEL, openaiChat),
    params: { maxOutputTokens: 2048 },
  },
  // Twilio voice agent (services/voice-agent.service.js — Responses API)
  voiceAgent: {
    provider: 'openai', kind: 'responses',
    id: openaiChat,
    params: { maxOutputTokens: 120 },
  },
  // Inbound voice-note transcription
  transcription: {
    provider: 'openai', kind: 'transcription',
    id: pick(env.OPENAI_TRANSCRIPTION_MODEL, DEFAULTS.openaiTranscription),
    params: {},
  },
  // Content Studio images
  image: {
    provider: 'openai', kind: 'image',
    id: pick(env.OPENAI_IMAGE_MODEL, DEFAULTS.openaiImage),
    params: { quality: env.OPENAI_IMAGE_QUALITY || 'medium' },
  },
  // Content Studio brand-DNA extraction (Anthropic)
  contentAnalysis: {
    provider: 'anthropic', kind: 'chat',
    id: pick(env.QUALIFIER_MODEL, DEFAULTS.anthropicAnalysis),
    params: { maxTokens: 900, temperature: 0 },
  },
  // Content Studio ad-copy generation (Anthropic)
  contentCopy: {
    provider: 'anthropic', kind: 'chat',
    id: pick(env.ANTHROPIC_MODEL, env.CLAUDE_MODEL, env.CLOSER_MODEL, DEFAULTS.anthropicCopy),
    params: { maxTokens: 4000, temperature: 0.75 },
  },
  // ElevenLabs cloned-voice TTS
  tts: {
    provider: 'elevenlabs', kind: 'tts',
    id: pick(env.ELEVENLABS_MODEL_ID, DEFAULTS.elevenlabsTts),
    params: {},
  },
};

/** The model ID for a role, e.g. modelId('closer'). Throws on an unknown role. */
const modelId = (role) => {
  const m = MODELS[role];
  if (!m) throw new Error(`config/models.js: unknown model role "${role}"`);
  return m.id;
};

/** Request parameters for a role (never mutated by callers). */
const modelParams = (role) => ({ ...(MODELS[role]?.params || {}) });

/**
 * Distinct (provider, kind, id) triples in use, with the roles that depend on
 * each — what the weekly health check probes.
 */
const listConfiguredModels = () => {
  const byKey = new Map();
  for (const [role, m] of Object.entries(MODELS)) {
    const key = `${m.provider}:${m.kind}:${m.id}`;
    if (!byKey.has(key)) byKey.set(key, { provider: m.provider, kind: m.kind, id: m.id, roles: [] });
    byKey.get(key).roles.push(role);
  }
  return [...byKey.values()];
};

module.exports = { MODELS, DEFAULTS, modelId, modelParams, listConfiguredModels };
