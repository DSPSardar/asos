// src/queues/message.queue.js
// BullMQ queue definitions for async message processing

const { Queue } = require('bullmq');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const MESSAGE_QUEUE = 'asos-messages';
const META_EVENTS_QUEUE = 'asos-meta-events';
const SCHEDULER_QUEUE = 'asos-scheduler';

const messageQueue = new Queue(MESSAGE_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    // A job that can't take the per-conversation lock throws so it retries
    // later. Now that the lock is held for as long as the job actually runs
    // (rather than expiring after 30s mid-pipeline), a message queued behind
    // a slow one needs enough attempts to outlast it — otherwise the lead's
    // follow-up is dropped instead of answered. Retries are safe to be
    // generous with: the worker skips any message that already has a reply.
    attempts: 5,
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
  // Dedup by WA message ID so Meta's webhook redeliveries collapse into a
  // single job. A replay (handback to AI) deliberately re-runs a message that
  // already has a job, so it needs its own id or BullMQ would silently drop
  // it — the worker is what decides whether the message still needs answering.
  const jobId = jobData.replay
    ? `msg_replay_${jobData.waMessageId}_${Date.now()}`
    : `msg_${jobData.waMessageId}`;

  const job = await messageQueue.add('inbound-message', jobData, { jobId });
  logger.debug({ jobId: job.id, waMessageId: jobData.waMessageId }, 'Message job queued');
  return job;
};

const publishStatusUpdate = async (jobData) => {
  return messageQueue.add('status-update', jobData, {
    jobId: `status_${jobData.waMessageId}_${jobData.status}`,
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
