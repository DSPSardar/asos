// src/modules/mcp/apiKeys.service.js
//
// Per-tenant API keys for the AI Assistant connector (MCP). A key is shown
// to the tenant admin exactly once; only its SHA-256 is stored, so a DB leak
// does not leak usable keys. Lookup is by hash (unique index), which makes a
// timing attack on the compare meaningless — there is no compare.
'use strict';

const crypto = require('node:crypto');
const prisma = require('../../config/database');
const { requestContext, getRequestContext } = require('../../middleware/requestContext.middleware');

const KEY_PREFIX = 'asos_';
const SCOPES = ['read']; // 'write' and 'pii' arrive with Phase 2
const MAX_ACTIVE_KEYS = 10;

const hashKey = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

const generateKey = () => `${KEY_PREFIX}${crypto.randomBytes(30).toString('base64url')}`;

const badRequest = (msg) => Object.assign(new Error(msg), { statusCode: 400, expose: true });
const notFound = () => Object.assign(new Error('Key not found'), { statusCode: 404, expose: true });

const publicShape = (k) => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes,
  lastUsedAt: k.lastUsedAt,
  revokedAt: k.revokedAt,
  createdAt: k.createdAt,
});

// Returns the raw key ONCE, alongside the stored row.
const createKey = async (tenantId, { name, createdBy = null } = {}) => {
  const label = String(name || '').trim().slice(0, 60);
  if (!label) throw badRequest('Give the key a name, e.g. "ChatGPT – Sardar"');
  const active = await prisma.apiKey.count({ where: { tenantId, revokedAt: null } });
  if (active >= MAX_ACTIVE_KEYS) throw badRequest(`Limit of ${MAX_ACTIVE_KEYS} active keys — revoke one first`);

  const raw = generateKey();
  const row = await prisma.apiKey.create({
    data: { tenantId, name: label, keyHash: hashKey(raw), prefix: raw.slice(0, 12), scopes: SCOPES, createdBy },
  });
  return { key: raw, apiKey: publicShape(row) };
};

const listKeys = async (tenantId) => (await prisma.apiKey.findMany({
  where: { tenantId },
  orderBy: { createdAt: 'desc' },
})).map(publicShape);

const revokeKey = async (tenantId, id) => {
  const row = await prisma.apiKey.findFirst({ where: { id, tenantId } });
  if (!row) throw notFound();
  if (row.revokedAt) return publicShape(row);
  return publicShape(await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } }));
};

// Key → { apiKeyId, tenantId, scopes } or null. Runs before any tenant is
// known, so it uses the named system_scope RLS policy. Same tenant rule as
// requireActiveTenant: a suspended or cancelled tenant's keys stop working.
const resolveKey = async (raw) => {
  if (typeof raw !== 'string' || !raw.startsWith(KEY_PREFIX) || raw.length < 20 || raw.length > 200) return null;
  // A fresh, isolated system-scope context — NOT runWithSystemScope, which
  // mutates the caller's store and would leave the rest of this request
  // running with rlsScope 'system' after the lookup returns.
  const row = await requestContext.run({ requestId: getRequestContext().requestId, rlsScope: 'system' }, () => prisma.apiKey.findUnique({
    where: { keyHash: hashKey(raw) },
    select: { id: true, tenantId: true, scopes: true, revokedAt: true, tenant: { select: { status: true } } },
  }));
  if (!row || row.revokedAt) return null;
  if (!row.tenant || ['SUSPENDED', 'CANCELLED'].includes(row.tenant.status)) return null;
  return { apiKeyId: row.id, tenantId: row.tenantId, scopes: row.scopes || [] };
};

// Best-effort, at most once a minute per key — never blocks a call.
const lastTouched = new Map();
const touchKey = (apiKeyId) => {
  const now = Date.now();
  if (now - (lastTouched.get(apiKeyId) || 0) < 60_000) return;
  lastTouched.set(apiKeyId, now);
  prisma.apiKey.update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } }).catch(() => {});
};

module.exports = { createKey, listKeys, revokeKey, resolveKey, touchKey, hashKey, generateKey, KEY_PREFIX, publicShape };
