// src/utils/logger.js
const pino = require('pino');
const env = require('../config/env');

const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
    : undefined,
  base: { service: 'asos-api', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
