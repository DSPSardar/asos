// src/modules/mcp/apiKeys.controller.js
// Settings → AI Assistants. Mounted under /settings, so TENANT_ADMIN only.
'use strict';

const svc = require('./apiKeys.service');
const { success, created } = require('../../utils/response');

// The public API origin the assistant should call. Railway serves the API on
// api.dspagenthub.com; PUBLIC_API_URL overrides it for staging.
const apiOrigin = (req) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

const list = async (req, res, next) => {
  try {
    return success(res, { keys: await svc.listKeys(req.tenantId), endpoint: `${apiOrigin(req)}/mcp` });
  } catch (e) { return next(e); }
};

const create = async (req, res, next) => {
  try {
    const out = await svc.createKey(req.tenantId, { name: req.body?.name, createdBy: req.user?.id || null });
    const endpoint = `${apiOrigin(req)}/mcp`;
    return created(res, {
      ...out,
      endpoint,
      // For assistants whose connector box only takes a URL.
      connectorUrl: `${endpoint}/k/${out.key}`,
      shownOnce: true,
    }, 'Key created — copy it now, it will not be shown again');
  } catch (e) { return next(e); }
};

const revoke = async (req, res, next) => {
  try {
    return success(res, await svc.revokeKey(req.tenantId, req.params.id), 'Key revoked');
  } catch (e) { return next(e); }
};

module.exports = { list, create, revoke, apiOrigin };
