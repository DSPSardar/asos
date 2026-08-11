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

module.exports = { requestContext, requestContextMiddleware, getRequestContext };
