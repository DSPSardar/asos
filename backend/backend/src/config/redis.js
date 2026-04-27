// src/config/redis.js
const IORedis = require('ioredis');
const env = require('./env');
const logger = require('../utils/logger');

const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error({ err }, 'Redis error'));

module.exports = redis;
