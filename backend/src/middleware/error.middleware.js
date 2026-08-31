// src/middleware/error.middleware.js
// Global error handler — catches all unhandled errors

const logger = require('../utils/logger');
const { error } = require('../utils/response');
const { ZodError } = require('zod');

// Axios errors carry the full request config (including the Authorization
// header and the whole request body). Logging `err` verbatim wrote a live Meta
// access token into Railway logs. Log a stripped view for those instead.
const safeError = (err) => {
  if (!err || !err.isAxiosError) return err;
  const headers = { ...(err.config?.headers || {}) };
  if (headers.Authorization) headers.Authorization = '[REDACTED]';
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    status: err.response?.status,
    responseData: err.response?.data,
    method: err.config?.method,
    url: err.config?.url,
    timeout: err.config?.timeout,
    headers,
    stack: err.stack,
  };
};

const errorHandler = (err, req, res, next) => {
  logger.error({
    err: safeError(err),
    method: req.method,
    url: req.url,
    tenantId: req.tenantId,
    userId: req.user?.id,
  }, 'Unhandled error');

  // Zod validation errors
  if (err instanceof ZodError) {
    return error(res, 'Validation failed', 422, err.flatten().fieldErrors);
  }

  // Prisma known errors
  if (err.code === 'P2002') {
    return error(res, 'A record with this value already exists', 409);
  }
  if (err.code === 'P2025') {
    return error(res, 'Record not found', 404);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') return error(res, 'Invalid token', 401);
  if (err.name === 'TokenExpiredError') return error(res, 'Token expired', 401);

  // Default
  const statusCode = err.statusCode || err.status || 500;
  const message = err.expose ? err.message : 'Internal server error';
  return error(res, message, statusCode);
};

const notFound = (req, res) => {
  return error(res, `Route ${req.method} ${req.url} not found`, 404);
};

module.exports = { errorHandler, notFound };
