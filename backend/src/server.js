// src/server.js
// HTTP server entrypoint

require('dotenv').config();
const createApp = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const prisma = require('./config/database');
const redis = require('./config/redis');

const PORT = parseInt(env.PORT, 10);

// Without these, Node's default behavior is a raw stderr dump — invisible
// to whatever structured-log tooling is watching Railway's output — and for
// unhandledRejection specifically, modern Node crashes the process anyway.
// This does not change that outcome (a corrupted process should not keep
// serving traffic), it makes sure the crash is logged through the same
// structured pipeline as everything else before the process exits, so it is
// findable rather than a plain-text needle in the deploy log.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — process exiting');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection — process exiting');
  process.exit(1);
});

const start = async () => {
  try {
    // Test DB connection
    await prisma.$connect();
    logger.info('PostgreSQL connected');

    // Test Redis (avoid double-connect when BullMQ already initialized it)
    if (redis.status === 'wait') {
      await redis.connect();
    } else {
      await redis.ping();
    }

    const app = createApp();
    const server = app.listen(PORT, () => {
      logger.info(`🚀 ASOS API running on port ${PORT} [${env.NODE_ENV}]`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        await prisma.$disconnect();
        await redis.quit();
        logger.info('Server closed');
        process.exit(0);
      });
      setTimeout(() => { logger.error('Forced shutdown'); process.exit(1); }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
};

start();
