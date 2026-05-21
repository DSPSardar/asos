// src/middleware/tenant.middleware.js
// Ensures tenant is ACTIVE and not suspended before processing requests

const { error } = require('../utils/response');

const requireActiveTenant = (req, res, next) => {
  // SUPERADMIN operates across all tenants and has no tenant of their own — always allow
  if (req.user?.role === 'SUPERADMIN') return next();
  const tenant = req.tenant;
  if (!tenant) return error(res, 'Tenant not found', 404);
  if (tenant.status === 'SUSPENDED') return error(res, 'Tenant account is suspended', 403);
  if (tenant.status === 'CANCELLED') return error(res, 'Tenant account is cancelled', 403);
  next();
};

// Ensures tenant has WhatsApp configured
const requireWhatsApp = (req, res, next) => {
  const tenant = req.tenant;
  if (!tenant?.waPhoneId || !tenant?.waAccessToken) {
    return error(res, 'WhatsApp not configured for this tenant. Please add credentials in Settings.', 400);
  }
  next();
};

module.exports = { requireActiveTenant, requireWhatsApp };
