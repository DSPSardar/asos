// src/middleware/websocket.middleware.js
// WebSocket handler for real-time updates
// Attaches WebSocket server to HTTP server and handles subscriptions

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../utils/logger');
const realtimeService = require('../services/realtime.service');

let wsServer = null;

// Initialize WebSocket server
const initializeWebSocket = async (server) => {
  if (wsServer) return wsServer;

  await realtimeService.initRedisSubsc();

  wsServer = new WebSocket.Server({
    server,
    path: '/ws',
    perMessageDeflate: false,
  });

  wsServer.on('connection', handleConnection);
  logger.info('WebSocket server initialized at /ws');

  return wsServer;
};

// Handle new WebSocket connection
const handleConnection = (ws, req) => {
  let tenantId = null;
  let userId = null;

  try {
    // Extract token from query string: ws://url?token=...
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'No authentication token provided');
      return;
    }

    // Verify JWT. auth.service signs { userId, tenantId, role } — reading
    // decoded.id here left userId undefined on every connection.
    const decoded = jwt.verify(token, env.JWT_SECRET);
    tenantId = decoded.tenantId;
    userId = decoded.userId;

    // A token without a tenant can't be scoped to any channel, and letting it
    // through would subscribe the socket under the key "undefined:<channel>".
    if (!tenantId) {
      ws.close(4003, 'Token missing tenant scope');
      return;
    }

    logger.debug(`WebSocket client connected: user=${userId}, tenant=${tenantId}`);

    // Subscribe to tenant channels
    realtimeService.subscribe(tenantId, 'leads:refresh', ws);
    realtimeService.subscribe(tenantId, 'lead:updated', ws);
    realtimeService.subscribe(tenantId, 'lead:stage-changed', ws);
    realtimeService.subscribe(tenantId, 'lead:note-added', ws);
    realtimeService.subscribe(tenantId, 'dashboard:updated', ws);

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'connection:established',
      tenantId,
      userId,
      timestamp: new Date().toISOString(),
    }));

    // Handle incoming messages (ping/pong, subscriptions, etc.)
    ws.on('message', (message) => handleMessage(ws, tenantId, userId, message));

    // Handle disconnection
    ws.on('close', () => handleClose(ws, tenantId, userId));

    ws.on('error', (error) => {
      logger.warn({ err: error, tenantId, userId }, 'WebSocket error');
    });

  } catch (err) {
    logger.warn({ err: err.message }, 'WebSocket authentication failed');
    ws.close(4003, 'Authentication failed');
  }
};

// Handle messages from client
const handleMessage = (ws, tenantId, userId, data) => {
  try {
    const message = JSON.parse(data);

    if (message.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      return;
    }

    if (message.type === 'subscribe') {
      const channel = message.channel;
      realtimeService.subscribe(tenantId, channel, ws);
      logger.debug(`Client subscribed to channel: ${channel}`);
      return;
    }

    if (message.type === 'unsubscribe') {
      const channel = message.channel;
      realtimeService.unsubscribe(tenantId, channel, ws);
      logger.debug(`Client unsubscribed from channel: ${channel}`);
      return;
    }

  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to parse WebSocket message');
  }
};

// Handle client disconnection
const handleClose = (ws, tenantId, userId) => {
  logger.debug(`WebSocket client disconnected: user=${userId}, tenant=${tenantId}`);

  // Drops the socket from every channel it holds, not just the four defaults —
  // anything joined via a 'subscribe' message would otherwise keep a reference
  // to a dead socket for the lifetime of the process.
  realtimeService.unsubscribeAll(ws);
};

module.exports = {
  initializeWebSocket,
};
