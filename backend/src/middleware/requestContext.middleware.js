// src/middleware/requestContext.middleware.js
//
// Gives every log line emitted during a request the same requestId, without
// threading req/req.log through the ~230 Prisma-adjacent call sites across
// services/workers that currently call the shared `logger` singleton
// directly. AsyncLocalStorage propagates the id through the async chain
// implicitly; utils/logger.js reads it back via pino's `mixin` option. If a
// production 500 shows up in Sentry (or wherever) with no code visible
// around it, the requestId is what lets you grep the raw log stream for
// every line — auth, tenant resolution, the Prisma call, the response — that
// belongs to that one request.
//
// Reuses an inbound X-Request-Id if the edge (Cloudflare, a future load
// balancer) already set one, so a trace stays a single id end-to-end instead
// of a different one at every hop. Generates a uuid otherwise.
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const requestContext = new AsyncLocalStorage();

const requestContextMiddleware = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  requestContext.run({ requestId }, next);
};

// Read by utils/logger.js's mixin — returns {} outside a request/job context
// (e.g. a script run via node directly), which pino merges as a no-op.
const getRequestContext = () => requestContext.getStore() || {};

// The same store now also carries the tenant identity used for Postgres
// row-level security (see config/database.js). Written by exactly three
// places, all of which derive it from something verified server-side:
//   - auth.middleware.js, from the DB row of the JWT-verified user
//   - conversation.worker.js, from job.data.tenantId (which originated from
//     the HMAC-verified WhatsApp webhook's waPhoneId lookup)
//   - runWithSystemScope below, for the explicit cross-tenant paths
// Never populate it from a request header or body — that is exactly the
// spoofable channel RLS exists to close.
const setTenantContext = ({ tenantId, rlsScope }) => {
  const store = requestContext.getStore();
  if (!store) return;
  if (tenantId !== undefined) store.tenantId = tenantId;
  if (rlsScope !== undefined) store.rlsScope = rlsScope;
};

// Explicit, logged cross-tenant scope for the few paths that legitimately
// operate across tenants: SUPERADMIN API requests, the Stripe webhook (tenant
// resolved mid-flow from the signature-verified event), and ops scripts.
// This is a named policy in Postgres ('system_scope'), not a superuser
// connection — every use is visible in the logs via the pino mixin.
const runWithSystemScope = (fn) => {
  const current = requestContext.getStore();
  if (current) {
    current.rlsScope = 'system';
    return fn();
  }
  return requestContext.run({ rlsScope: 'system' }, fn);
};

// Multer (and anything else that hands control back from a body stream's
// 'finish' event) invokes the next handler from the socket's async context,
// not the one requestContextMiddleware started — so getStore() is empty and
// every Prisma write downstream runs with no tenant set, which RLS rejects as
// "new row violates row-level security policy". Mount this AFTER the multer
// call to re-enter the request's context from the verified values auth
// already put on req. Same derivation rules as auth.middleware.js.
const rehydrateRequestContext = (req, res, next) => {
  const user = req.user;
  const store = {
    requestId: req.id,
    tenantId: user?.role === 'SUPERADMIN' ? '' : (req.tenantId || user?.tenantId || ''),
    rlsScope: user?.role === 'SUPERADMIN' ? 'system' : '',
  };
  requestContext.run(store, next);
};

module.exports = {
  requestContext,
  requestContextMiddleware,
  getRequestContext,
  setTenantContext,
  runWithSystemScope,
  rehydrateRequestContext,
};
