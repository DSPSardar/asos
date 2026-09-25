// src/middleware/readApiKey.js
//
// Read-only API-key auth for the SARDAR showcase page. Purely additive: a
// request without an X-API-Key header passes straight through to the JWT
// guard, untouched. A request WITH the header is decided here and never
// falls through to JWT — a bad key is a 401, not a second chance.
//
// What a valid key gets:
//   - method GET only (anything else is 401 before the key is even compared)
//   - the fixed tenant from ASOS_READ_API_TENANT_ID, never anything the
//     client sent — same rule as auth.middleware.js / requestContext
//   - role READ_ONLY, allowed on the ALLOWED_PATHS list below and nowhere
//     else (403)
//   - 60 requests/minute per key, on top of the global /api limiter
//   - responses with phone / email / bank / payment fields stripped
//
// The key value is never logged. Compare is constant-time on SHA-256
// digests so a length mismatch can't short-circuit timingSafeEqual.

const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { requestContext, getRequestContext } = require('./requestContext.middleware');

const HEADER = 'x-api-key';
const ROLE = 'READ_ONLY';

// Full paths (baseUrl + path, query stripped). Compared exactly, so
// /leads/pipeline/ or /leads/pipeline/x are not matches.
const ALLOWED_PATHS = new Set([
  `/api/${env.API_VERSION}/leads/pipeline`,
  `/api/${env.API_VERSION}/leads/hot`,
  `/api/${env.API_VERSION}/insights/sentiment`,
  `/api/${env.API_VERSION}/insights/signals`,
  `/api/${env.API_VERSION}/insights/digest`,
  // Backs the KPI tiles on /dsp-reports (vite-app/src/pages/DSPReports.jsx).
  `/api/${env.API_VERSION}/analytics/overview`,
  `/api/${env.API_VERSION}/analytics/enrollments`,
]);

// Any key (at any depth) whose name mentions one of these is dropped from a
// READ_ONLY response. Names, counts and amounts survive. This is key-based:
// a phone number typed inside a free-text message body is not caught.
const STRIP_KEY = /phone|e-?mail|bank|payment|iban/i;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

const keyMatches = (presented) => {
  const expected = env.ASOS_READ_API_KEY;
  if (!expected || typeof presented !== 'string' || presented.length === 0) return false;
  return crypto.timingSafeEqual(sha256(presented), sha256(expected));
};

const stripSensitive = (value) => {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (STRIP_KEY.test(k)) continue;
      out[k] = stripSensitive(v);
    }
    return out;
  }
  return value;
};

// Per-key bucket, keyed by a hash of the key — the raw value never reaches
// the store or the logs. Only reached after the key has been verified, so
// guesses can't fill a bucket; those are covered by the global IP limiter.
const perKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => `k:${sha256(req.headers[HEADER]).toString('hex').slice(0, 32)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

const readApiKey = (req, res, next) => {
  const presented = req.headers[HEADER];
  if (presented === undefined) return next(); // no key → normal JWT path

  const tenantId = env.ASOS_READ_API_TENANT_ID;
  if (req.method !== 'GET' || !tenantId || !keyMatches(presented)) {
    return res.status(401).json({ error: 'invalid_api_key' });
  }

  return perKeyLimiter(req, res, (err) => {
    if (err) return next(err);

    if (!ALLOWED_PATHS.has(req.baseUrl + req.path)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    req.apiKeyAuth = true;
    req.tenantId = tenantId;
    req.user = { id: null, role: ROLE, tenantId };

    const json = res.json.bind(res);
    res.json = (body) => json(stripSensitive(body));

    // Same AsyncLocalStorage pattern the workers use, so Postgres RLS
    // (config/database.js) sees the tenant on every query this request makes.
    return requestContext.run({ ...getRequestContext(), tenantId, rlsScope: '' }, next);
  });
};

// Wraps an existing guard so it is skipped once the API key has already
// authenticated the request. Without the key header this is a no-op.
const unlessApiKey = (mw) => (req, res, next) => (req.apiKeyAuth ? next() : mw(req, res, next));

module.exports = { readApiKey, unlessApiKey, ALLOWED_PATHS, stripSensitive };
