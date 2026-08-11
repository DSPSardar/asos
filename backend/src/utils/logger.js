// src/utils/logger.js
const pino = require('pino');
const env = require('../config/env');

// mixin runs on every log call and merges its return value into that line.
// This is how every logger.info/warn/error call across the ~230 sites that
// already import this module gets requestId for free, without any of them
// changing — see requestContext.middleware.js for where the id comes from
// and why this approach was chosen over threading req.log through services.
// requestContext.middleware.js only imports Node built-ins (no dependency
// back on this file), so there is no load-order cycle to worry about here.
const { getRequestContext } = require('../middleware/requestContext.middleware');

const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
    : undefined,
  base: { service: 'asos-api', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin: () => getRequestContext(),
});

module.exports = logger;
