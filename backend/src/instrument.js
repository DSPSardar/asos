// src/instrument.js
//
// Must be the very first thing required by every backend entrypoint —
// server.js and workers/conversation.worker.js — before any other require,
// including express/bullmq/prisma. Sentry's Node SDK auto-instruments
// built-in modules (http, etc.) by monkey-patching them at import time; if
// something else imports them first, Sentry's instrumentation misses those
// call sites. dotenv is loaded here too, deliberately ahead of Sentry.init,
// so a local `.env` file is respected the same way it was before this file
// existed (server.js used to call require('dotenv').config() as its own
// first line).
//
// Safe with no DSN configured: Sentry.init() no-ops every capture call when
// dsn is empty/undefined — this is documented SDK behavior, not something
// this file has to guard itself. That matters right now: neither
// SENTRY_DSN nor VITE_SENTRY_DSN exist on any Railway service as of this
// commit, despite the task that asked for this integration assuming they
// already did. Everything ships inert until that's actually set.
require('dotenv').config();

const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  // No release/version field ever existed for the backend (package.json's
  // version is a static, never-bumped "1.0.0") — RAILWAY_GIT_COMMIT_SHA is
  // Railway's own build-time variable and is the only thing that actually
  // changes per deploy, so it's what makes a Sentry release meaningful.
  release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
  // 4xx responses the app deliberately throws with `expose: true` (bad
  // credentials, validation errors, "conversation not found" after a
  // tenant-isolation check) are routine and expected — Sentry should not
  // treat every failed login as an incident. Kept in sync with app.js's
  // setupExpressErrorHandler shouldHandleError, which applies the same
  // rule for errors reaching Express's own error-handling chain.
  beforeSend(event, hint) {
    const err = hint?.originalException;
    if (err && err.expose && Number(err.statusCode) < 500) return null;
    return event;
  },
});

module.exports = Sentry;
