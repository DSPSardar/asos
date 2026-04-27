// src/queues/message.queue.js
// BullMQ queue definitions for async message processing

const { Queue } = require('bullmq');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const MESSAGE_QUEUE = 'asos:messages';
const META_EVENTS_QUEUE = 'asos:meta-events';
const SCHEDULER_QUEUE = 'asos:scheduler';

const messageQueue = new Queue(MESSAGE_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

const metaEventsQueue = new Queue(META_EVENTS_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

const schedulerQueue = new Queue(SCHEDULER_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

// ── Job publishers ────────────────────────────────────────────────────

const publishInboundMessage = async (jobData) => {
  const job = await messageQueue.add('inbound-message', jobData, {
    jobId: `msg:${jobData.waMessageId}`, // Dedup by WA message ID
  });
  logger.debug({ jobId: job.id, waMessageId: jobData.waMessageId }, 'Message job queued');
  return job;
};

const publishStatusUpdate = async (jobData) => {
  return messageQueue.add('status-update', jobData, {
    jobId: `status:${jobData.waMessageId}:${jobData.status}`,
  });
};

const publishMetaEvent = async (eventData) => {
  return metaEventsQueue.add('capi-event', eventData);
};

const scheduleFollowUp = async (leadId, tenantId, delayMs) => {
  return schedulerQueue.add('follow-up', { leadId, tenantId }, {
    delay: delayMs,
    jobId: `followup:${leadId}`,
  });
};

module.exports = {
  messageQueue,
  metaEventsQueue,
  schedulerQueue,
  publishInboundMessage,
  publishStatusUpdate,
  publishMetaEvent,
  scheduleFollowUp,
  QUEUE_NAMES: { MESSAGE_QUEUE, META_EVENTS_QUEUE, SCHEDULER_QUEUE },
};
