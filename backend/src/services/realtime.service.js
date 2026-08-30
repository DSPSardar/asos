// src/services/realtime.service.js
// Real-time updates broadcast system — pushes changes to all connected clients.
//
// Delivery has two paths, and both matter:
//   1. Local  — the WebSocket clients attached to THIS process, written to directly.
//   2. Redis  — a pattern-subscribed fan-out so the other API instances deliver to
//               the clients attached to them.
//
// A message published by this process is skipped when it comes back around on the
// Redis path (see ORIGIN), because path 1 already delivered it. Without that guard
// every client on the publishing instance receives each event twice.

const crypto = require('crypto');
const redis = require('../config/redis');
const logger = require('../utils/logger');

// In-memory map of subscriptions: { `${tenantId}:${channel}` -> Set<WebSocket> }
const subscriptions = new Map();

// Identifies this process among the instances sharing the Redis. Used to drop our
// own echo rather than double-delivering to local clients.
const ORIGIN = crypto.randomUUID();

// Every broadcast channel is published under this prefix so one pattern covers all.
const CHANNEL_PREFIX = 'broadcast';
const CHANNEL_PATTERN = `${CHANNEL_PREFIX}:*`;

let redisPubSub = null;

// ── Redis pub/sub wiring ──────────────────────────────────────────────

const initRedisSubsc = async () => {
  if (redisPubSub) return redisPubSub;

  try {
    const sub = redis.duplicate();

    // config/redis sets lazyConnect, which duplicate() inherits — but a duplicate
    // can also arrive already connecting. Calling connect() on a non-idle client
    // throws, so only connect when it is actually idle.
    if (sub.status === 'wait' || sub.status === 'end') {
      await sub.connect();
    }

    // psubscribe, NOT subscribe: 'broadcast:*' is a glob. subscribe() takes the
    // pattern as a literal channel name and its second argument is the completion
    // callback (err, count) — not a message handler.
    await sub.psubscribe(CHANNEL_PATTERN);

    // Pattern messages arrive as (pattern, channel, payload) — three arguments.
    sub.on('pmessage', (_pattern, channel, payload) => {
      handleBroadcast(channel, payload);
    });

    sub.on('error', (err) => {
      // Never rethrow out of an event handler: an uncaught error here reaches the
      // process-level uncaughtException handler and takes the API down.
      logger.error({ err }, 'Real-time Redis subscriber error');
    });

    redisPubSub = sub;
    logger.info('Real-time Redis pub/sub initialized');
    return redisPubSub;
  } catch (err) {
    // Cross-instance fan-out is an enhancement, not a precondition for serving
    // traffic. Degrade to local-only delivery rather than refusing to boot.
    logger.error({ err }, 'Real-time Redis pub/sub unavailable — local-only delivery');
    return null;
  }
};

const closeRedisSubsc = async () => {
  if (!redisPubSub) return;
  try {
    await redisPubSub.quit();
  } catch (err) {
    logger.warn({ err }, 'Error closing real-time subscriber');
  } finally {
    redisPubSub = null;
  }
};

// ── Client registry ───────────────────────────────────────────────────

const keyFor = (tenantId, channel) => `${tenantId}:${channel}`;

const subscribe = (tenantId, channel, client) => {
  const key = keyFor(tenantId, channel);
  if (!subscriptions.has(key)) subscriptions.set(key, new Set());
  subscriptions.get(key).add(client);
  // TEMPORARY DIAGNOSTIC: confirms the exact key a live socket is listening on.
  logger.info({ key, sockets: subscriptions.get(key).size }, 'realtime: client subscribed');
};

const unsubscribe = (tenantId, channel, client) => {
  const key = keyFor(tenantId, channel);
  const subs = subscriptions.get(key);
  if (!subs) return;
  subs.delete(client);
  if (subs.size === 0) subscriptions.delete(key);
};

// Removes a client from every channel it holds. handleClose used to unsubscribe
// only the four default channels, so anything a client joined via a 'subscribe'
// message leaked a reference and kept the socket object alive after disconnect.
const unsubscribeAll = (client) => {
  for (const [key, subs] of subscriptions) {
    if (subs.delete(client) && subs.size === 0) subscriptions.delete(key);
  }
};

const OPEN = 1; // WebSocket.OPEN

// Writes to the live clients on this process and drops any that have gone away.
const deliverLocal = (key, message) => {
  const subs = subscriptions.get(key);
  if (!subs || subs.size === 0) return 0;

  let delivered = 0;
  // Snapshot before iterating: send() can trigger a synchronous 'close', which
  // mutates this Set through unsubscribeAll while it is being walked.
  for (const client of [...subs]) {
    if (client.readyState !== OPEN) {
      subs.delete(client);
      continue;
    }
    try {
      client.send(message);
      delivered += 1;
    } catch (err) {
      logger.warn({ err }, 'Failed to write to WebSocket client');
      subs.delete(client);
    }
  }
  if (subs.size === 0) subscriptions.delete(key);
  return delivered;
};

// ── Broadcast ─────────────────────────────────────────────────────────

const broadcast = async (tenantId, channel, data) => {
  const key = keyFor(tenantId, channel);
  const envelope = {
    type: channel,
    data,
    timestamp: new Date().toISOString(),
  };

  const delivered = deliverLocal(key, JSON.stringify(envelope));

  // Cross-instance fan-out. This runs after the caller's transaction has already
  // committed, so a Redis failure must never propagate — the write succeeded and
  // the request must not report an error. Worst case other instances miss the
  // nudge and their clients refresh on the next poll or navigation.
  try {
    await redis.publish(
      `${CHANNEL_PREFIX}:${key}`,
      JSON.stringify({ origin: ORIGIN, payload: envelope }),
    );
  } catch (err) {
    logger.error({ err, tenantId, channel }, 'Redis publish failed — local delivery only');
  }

  // TEMPORARY DIAGNOSTIC (info level): proves whether a broadcast is published
  // and how many local sockets it reached. Drop back to debug once the
  // new-leads-not-appearing issue is closed.
  logger.info({ tenantId, channel, localDelivered: delivered, origin: ORIGIN.slice(0, 8) },
    'realtime: published');
  return delivered;
};

// Handles a broadcast arriving from Redis (published by any instance, us included).
// Everything is inside try/catch: this runs on an ioredis event emitter, so an
// exception escaping here is an uncaughtException and kills the process.
const handleBroadcast = (channel, raw) => {
  try {
    // Channel format: broadcast:<tenantId>:<eventType>, where eventType itself
    // contains colons ('lead:stage-changed'), so rejoin everything after index 1.
    const parts = String(channel).split(':');
    if (parts.length < 3) return;

    const tenantId = parts[1];
    const eventType = parts.slice(2).join(':');

    const message = JSON.parse(raw);

    // Our own echo — deliverLocal already handled these clients.
    if (message.origin === ORIGIN) return;

    const envelope = message.payload ?? message;
    const delivered = deliverLocal(keyFor(tenantId, eventType), JSON.stringify({ ...envelope, source: 'redis' }));
    // TEMPORARY DIAGNOSTIC: delivered=0 with subscribers>0 means the channel key
    // does not match what any socket subscribed to.
    logger.info({ tenantId, eventType, delivered, subscriptionKeys: subscriptions.size },
      'realtime: received from redis');
  } catch (err) {
    logger.warn({ err, channel }, 'Discarded malformed real-time broadcast');
  }
};

// ── Typed event helpers ───────────────────────────────────────────────

const broadcastLeadUpdate = (tenantId, lead) =>
  broadcast(tenantId, 'lead:updated', { leadId: lead.id, lead });

const broadcastLeadStageChange = (tenantId, leadId, fromStage, toStage) =>
  broadcast(tenantId, 'lead:stage-changed', { leadId, fromStage, toStage });

const broadcastLeadsRefresh = (tenantId) =>
  broadcast(tenantId, 'leads:refresh', { timestamp: new Date().toISOString() });

const broadcastDashboardUpdate = (tenantId) =>
  broadcast(tenantId, 'dashboard:updated', { timestamp: new Date().toISOString() });

module.exports = {
  initRedisSubsc,
  closeRedisSubsc,
  subscribe,
  unsubscribe,
  unsubscribeAll,
  broadcast,
  broadcastLeadUpdate,
  broadcastLeadStageChange,
  broadcastLeadsRefresh,
  broadcastDashboardUpdate,
  _internal: { subscriptions, ORIGIN },
};
