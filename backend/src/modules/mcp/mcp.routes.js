// src/modules/mcp/mcp.routes.js
//
// POST /mcp            — key in `Authorization: Bearer asos_…` or `X-API-Key`
// POST /mcp/k/:key     — key in the URL, for assistants whose "custom
//                        connector" box only takes a URL (ChatGPT developer
//                        mode, Claude custom connectors without OAuth).
//
// Mounted in app.js BEFORE morgan so a key in the URL never reaches the
// access log; this router logs its own redacted line instead. Stateless:
// GET (SSE stream) and DELETE (session end) are 405, per the MCP spec for
// servers without sessions.
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const logger = require('../../utils/logger');
const { requestContext, getRequestContext } = require('../../middleware/requestContext.middleware');
const { resolveKey, touchKey } = require('./apiKeys.service');
const { buildServer } = require('./mcp.server');

const presentedKey = (req) => {
  if (req.params?.key) return req.params.key;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.headers['x-api-key'] || null;
};

const keyBucket = (req) => `mcp:${crypto.createHash('sha256').update(String(presentedKey(req) || req.ip)).digest('hex').slice(0, 32)}`;

const rpcError = (res, status, code, message) => res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

const router = express.Router();

router.use(express.json({ limit: '1mb' }));

// 120 calls/min per key — an assistant fans out a few tool calls per question.
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: keyBucket,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => rpcError(res, 429, -32000, 'Too many requests — slow down.'),
}));

const authenticateKey = async (req, res, next) => {
  try {
    const found = await resolveKey(presentedKey(req));
    if (!found) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="asos"');
      return rpcError(res, 401, -32001, 'Invalid or revoked ASOS API key. Create one in Settings → AI Assistants.');
    }
    if (!found.scopes.includes('read')) return rpcError(res, 403, -32003, 'This key has no read access.');
    req.mcp = found;
    return next();
  } catch (err) {
    return next(err);
  }
};

const handle = async (req, res) => {
  const { tenantId, apiKeyId } = req.mcp;
  const started = Date.now();

  return requestContext.run({ requestId: getRequestContext().requestId, tenantId, rlsScope: '' }, async () => {
    logger.info({ apiKeyId, method: req.body?.method, tool: req.body?.params?.name }, 'MCP request');
    touchKey(apiKeyId);
    const server = buildServer({ tenantId, apiKeyId });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err: err.message, tenantId }, 'MCP: request failed');
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal error');
    } finally {
      logger.debug({ ms: Date.now() - started }, 'MCP request done');
    }
  });
};

const notAllowed = (req, res) => {
  res.setHeader('Allow', 'POST');
  return rpcError(res, 405, -32000, 'Method not allowed — this server is stateless; use POST.');
};

router.post('/', authenticateKey, handle);
router.post('/k/:key', authenticateKey, handle);
router.get(['/', '/k/:key'], notAllowed);
router.delete(['/', '/k/:key'], notAllowed);

module.exports = router;
