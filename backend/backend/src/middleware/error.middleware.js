// src/middleware/error.middleware.js
// Global error handler — catches all unhandled errors

const logger = require('../utils/logger');
const { error } = require('../utils/response');
const { ZodError } = require('zod');

const errorHandler = (err, req, res, next) => {
  logger.error({
    err,
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
