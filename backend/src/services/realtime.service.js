// src/services/realtime.service.js
// Real-time updates broadcast system — pushes changes to all connected clients
// This service handles WebSocket connections, subscriptions, and broadcasts.

const redis = require('../config/redis');
const logger = require('../utils/logger');

// In-memory map of subscriptions: { tenantId+channel -> Set<client> }
const subscriptions = new Map();

// Redis pub/sub for multi-process broadcast (across different server instances)
let redisPubSub = null;

const initRedisSubsc = async () => {
  if (redisPubSub) return redisPubSub;

  redisPubSub = redis.duplicate();
  await redisPubSub.connect();

  // Subscribe to all broadcast channels
  await redisPubSub.subscribe('broadcast:*', (message, channel) => {
    handleBroadcast(channel, JSON.parse(message));
  });

  logger.info('Real-time Redis pub/sub initialized');
  return redisPubSub;
};

// Register a WebSocket client for a tenant
const subscribe = (tenantId, channel, client) => {
  const key = `${tenantId}:${channel}`;
  if (!subscriptions.has(key)) {
    subscriptions.set(key, new Set());
  }
  subscriptions.get(key).add(client);
  logger.debug(`Client subscribed to ${key}`);
};

// Unregister a client
const unsubscribe = (tenantId, channel, client) => {
  const key = `${tenantId}:${channel}`;
  const subs = subscriptions.get(key);
  if (subs) {
    subs.delete(client);
    if (subs.size === 0) {
      subscriptions.delete(key);
    }
  }
};

// Broadcast a change to all clients in a tenant
const broadcast = async (tenantId, channel, data) => {
  const key = `${tenantId}:${channel}`;
  const message = JSON.stringify({
    type: channel,
    data,
    timestamp: new Date().toISOString(),
  });

  // Send to local clients
  const subs = subscriptions.get(key);
  if (subs && subs.size > 0) {
    subs.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      } else {
        subs.delete(client); // Clean up dead connections
      }
    });
  }

  // Broadcast to other processes via Redis
  await redis.publish(`broadcast:${key}`, JSON.stringify(data));

  logger.debug(`Broadcast to ${key}: ${channel}`, { tenantId, channel });
};

// Handle broadcasts from Redis (other processes)
const handleBroadcast = (channel, data) => {
  // Extract tenantId and eventType from channel
  // Format: broadcast:tenantId:eventType
  const parts = channel.split(':');
  if (parts.length >= 3) {
    const tenantId = parts[1];
    const eventType = parts.slice(2).join(':');
    const key = `${tenantId}:${eventType}`;

    const subs = subscriptions.get(key);
    if (subs && subs.size > 0) {
      const message = JSON.stringify({
        type: eventType,
        data,
        timestamp: new Date().toISOString(),
        source: 'redis',
      });

      subs.forEach(client => {
        if (client.readyState === 1) {
          client.send(message);
        }
      });
    }
  }
};

// Broadcast specific events
const broadcastLeadUpdate = async (tenantId, lead) => {
  await broadcast(tenantId, 'lead:updated', { leadId: lead.id, lead });
};

const broadcastLeadStageChange = async (tenantId, leadId, fromStage, toStage) => {
  await broadcast(tenantId, 'lead:stage-changed', { leadId, fromStage, toStage });
};

const broadcastLeadsRefresh = async (tenantId) => {
  await broadcast(tenantId, 'leads:refresh', { timestamp: new Date().toISOString() });
};

const broadcastDashboardUpdate = async (tenantId) => {
  await broadcast(tenantId, 'dashboard:updated', { timestamp: new Date().toISOString() });
};

module.exports = {
  initRedisSubsc,
  subscribe,
  unsubscribe,
  broadcast,
  broadcastLeadUpdate,
  broadcastLeadStageChange,
  broadcastLeadsRefresh,
  broadcastDashboardUpdate,
};
