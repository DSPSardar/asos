// src/config/env.js
// Validates all environment variables at startup using Zod
// The app will CRASH on boot if any required var is missing

const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV:                z.enum(['development', 'production', 'test']).default('development'),
  PORT:                    z.string().default('3000'),
  API_VERSION:             z.string().default('v1'),

  DATABASE_URL:            z.string().url(),
  DSP_DB_HOST:             z.string().default('127.0.0.1'),
  DSP_DB_PORT:             z.string().default('3306'),
  DSP_DB_NAME:             z.string().default('dsp_crm'),
  DSP_DB_USER:             z.string().optional(),
  DSP_DB_PASSWORD:         z.string().optional(),

  REDIS_URL:               z.string().default('redis://localhost:6379'),

  JWT_SECRET:              z.string().min(32),
  JWT_EXPIRES_IN:          z.string().default('15m'),
  JWT_REFRESH_SECRET:      z.string().min(32),
  JWT_REFRESH_EXPIRES_IN:  z.string().default('7d'),

  WHATSAPP_API_URL:        z.string().url().default('https://graph.facebook.com/v20.0'),
  WHATSAPP_APP_SECRET:     z.string().optional().default('mock-secret'),
  WHATSAPP_VERIFY_TOKEN:   z.string().optional().default('mock-verify-token'),
  WHATSAPP_MOCK:           z.enum(['true','false']).optional().default('false'),

  // OpenAI powers the customer-facing WhatsApp sales agent.
  OPENAI_API_KEY:          z.string().startsWith('sk-'),
  OPENAI_MODEL:            z.string().default('gpt-5.4-mini'),
  OPENAI_QUALIFIER_MODEL:  z.string().optional(),
  OPENAI_CLOSER_MODEL:     z.string().optional(),

  // Twilio connects the existing WhatsApp Business sender to Calling.
  TWILIO_ACCOUNT_SID:      z.string().optional(),
  TWILIO_AUTH_TOKEN:       z.string().optional(),
  // Verified caller ID for standard phone calls. This stays separate from the
  // Meta WhatsApp sender used for messages and voice notes.
  TWILIO_VOICE_FROM:       z.string().optional(),
  TWILIO_WHATSAPP_FROM:    z.string().optional(),
  VOICE_WEBHOOK_BASE_URL:  z.string().url().optional(),

  // Kept optional while Content Studio is migrated separately.
  ANTHROPIC_API_KEY:       z.string().startsWith('sk-ant-').optional(),
  CLAUDE_MODEL:            z.string().optional(),
  CLAUDE_MAX_TOKENS:       z.string().default('512'),
  CLAUDE_TEMPERATURE:      z.string().default('0.3'),

  // v1.5 dual-agent model overrides — optional, fall back to defaults in claude.service.js
  // QUALIFIER → claude-haiku (fast/cheap analysis)
  // CLOSER    → claude-sonnet (better persuasive copy)
  QUALIFIER_MODEL:         z.string().optional(),
  CLOSER_MODEL:            z.string().optional(),

  META_API_URL:            z.string().url().default('https://graph.facebook.com'),
  META_API_VERSION:        z.string().default('v20.0'),

  // Optional — voice-note replies via a cloned voice. Feature stays a no-op
  // (plain text replies only) unless both are set.
  ELEVENLABS_API_KEY:      z.string().optional(),
  ELEVENLABS_VOICE_ID:     z.string().optional(),

  REPLICATE_API_TOKEN:     z.string().optional(),
  REPLICATE_MODEL:         z.string().default('black-forest-labs/flux-dev'),
  /** Optional. If set (e.g. https://api.yourdomain.com), draft image API returns imageAbsoluteUrl so the SPA works when only /api is proxied to Node and /uploads needs the full API origin. */
  PUBLIC_UPLOADS_BASE:     z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().url().optional()),
  REPORTS_DIR:             z.string().default('uploads/reports'),

  GOOGLE_CLIENT_ID:        z.string().optional(),

  STRIPE_SECRET_KEY:       z.string().optional(),
  STRIPE_WEBHOOK_SECRET:   z.string().optional(),

  RESEND_API_KEY:          z.string().optional(),
  EMAIL_FROM:              z.string().email().optional(),
  PASSWORD_RESET_URL:      z.string().url().default('https://asos-kappa.vercel.app/reset-password'),

  APP_URL:                 z.string().url().default('http://localhost:3001'),
  ALLOWED_ORIGINS:         z.string().default('http://localhost:3001'),
  LOG_LEVEL:               z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
});

let env;
try {
  env = envSchema.parse(process.env);
} catch (err) {
  console.error('❌  Invalid environment variables:\n', err.flatten().fieldErrors);
  process.exit(1);
}

module.exports = env;
