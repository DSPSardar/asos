// vite-app/src/hooks/useRealtimeSync.js
// React hook for real-time data synchronization across tabs
// Subscribes to WebSocket and automatically refetches data on changes

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';

let globalWs = null; // Shared WebSocket connection
let wsInitPromise = null;

// Initialize global WebSocket connection (shared across all components)
const initializeWebSocket = async (token) => {
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    return globalWs;
  }

  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    try {
      globalWs = new WebSocket(wsUrl);

      globalWs.onopen = () => {
        console.log('✅ WebSocket connected');
        resolve(globalWs);
      };

      globalWs.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        reject(error);
      };

      globalWs.onclose = () => {
        console.log('WebSocket disconnected');
        globalWs = null;
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      reject(err);
    }
  });
};

// Hook to subscribe to real-time updates
export const useRealtimeSync = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const handlersRef = useRef(new Map()); // Store message handlers

  // Subscribe to a specific event type
  const onEvent = useCallback((eventType, handler) => {
    if (!handlersRef.current.has(eventType)) {
      handlersRef.current.set(eventType, new Set());
    }
    handlersRef.current.get(eventType).add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = handlersRef.current.get(eventType);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }, []);

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) return;

    const handleMessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const { type, data, timestamp } = message;

        console.log(`📡 Real-time update: ${type}`, { data, timestamp });

        // Fire handlers for this event type
        const handlers = handlersRef.current.get(type);
        if (handlers) {
          handlers.forEach(handler => handler(data));
        }

        // Auto-invalidate queries based on event type
        handleAutoInvalidation(type, data, queryClient);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    globalWs.addEventListener('message', handleMessage);
    return () => globalWs.removeEventListener('message', handleMessage);
  }, [queryClient]);

  // Connect WebSocket on mount
  useEffect(() => {
    if (!user?.token) return;

    const setupConnection = async () => {
      try {
        if (!wsInitPromise) {
          wsInitPromise = initializeWebSocket(user.token);
        }
        wsRef.current = await wsInitPromise;

        // Clear any pending reconnect
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
      } catch (err) {
        console.error('Failed to connect WebSocket:', err);

        // Reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          wsInitPromise = null; // Reset promise on reconnect
          setupConnection();
        }, 5000);
      }
    };

    setupConnection();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [user?.token]);

  return { onEvent };
};

// Auto-invalidate queries based on event type
const handleAutoInvalidation = (eventType, data, queryClient) => {
  switch (eventType) {
    case 'lead:updated':
    case 'lead:stage-changed':
      // Invalidate leads query and lead detail
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      if (data.leadId) {
        queryClient.invalidateQueries({ queryKey: ['lead', data.leadId] });
      }
      break;

    case 'leads:refresh':
      // Full leads refresh
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      queryClient.invalidateQueries({ queryKey: ['hotLeads'] });
      break;

    case 'dashboard:updated':
      // Refresh dashboard data
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      break;

    case 'lead:note-added':
      // Invalidate lead activities
      if (data.leadId) {
        queryClient.invalidateQueries({ queryKey: ['lead', data.leadId, 'activities'] });
      }
      break;

    default:
      break;
  }
};

// Manual broadcast helper (for debugging)
export const broadcastMessage = (ws, type, data) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('WebSocket not connected');
    return;
  }

  ws.send(JSON.stringify({ type, data, timestamp: new Date().toISOString() }));
};

// Hook to use real-time sync in components
export const useRealtimeLeads = () => {
  const { onEvent } = useRealtimeSync();

  useEffect(() => {
    // Subscribe to lead updates
    return onEvent('lead:updated', (data) => {
      console.log('Lead updated in real-time:', data);
    });
  }, [onEvent]);
};
