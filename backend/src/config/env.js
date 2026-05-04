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
  WHATSAPP_APP_SECRET:     z.string().min(1),
  WHATSAPP_VERIFY_TOKEN:   z.string().min(1),

  ANTHROPIC_API_KEY:       z.string().startsWith('sk-ant-'),
  CLAUDE_MODEL:            z.string().default('claude-3-5-sonnet-20241022'),
  CLAUDE_MAX_TOKENS:       z.string().default('512'),
  CLAUDE_TEMPERATURE:      z.string().default('0.3'),

  // v1.5 dual-agent model overrides — optional, fall back to defaults in claude.service.js
  // QUALIFIER → claude-haiku (fast/cheap analysis)
  // CLOSER    → claude-sonnet (better persuasive copy)
  QUALIFIER_MODEL:         z.string().optional(),
  CLOSER_MODEL:            z.string().optional(),

  META_API_URL:            z.string().url().default('https://graph.facebook.com'),
  META_API_VERSION:        z.string().default('v20.0'),

  REPLICATE_API_TOKEN:     z.string().optional(),
  REPLICATE_MODEL:         z.string().default('black-forest-labs/flux-dev'),
  REPORTS_DIR:             z.string().default('uploads/reports'),

  GOOGLE_CLIENT_ID:        z.string().optional(),

  STRIPE_SECRET_KEY:       z.string().optional(),
  STRIPE_WEBHOOK_SECRET:   z.string().optional(),

  RESEND_API_KEY:          z.string().optional(),
  EMAIL_FROM:              z.string().email().optional(),

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
