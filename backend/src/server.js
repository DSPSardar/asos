// src/server.js
// HTTP server entrypoint

require('dotenv').config();
const createApp = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const prisma = require('./config/database');
const redis = require('./config/redis');

const PORT = parseInt(env.PORT, 10);

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
