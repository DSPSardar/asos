// src/hooks/useRealtimeSync.js
// Keeps every open tab in sync with the server over a single WebSocket.
//
// One connection is shared by the whole app (module-level, not per-component).
// The socket carries the same JWT the REST client uses, and the server scopes
// every message to that token's tenant.
//
// Usage:
//   main.jsx      — useRealtimeSync()               (once, to hold the connection)
//   a page        — useRealtimeRefresh(loadDbLeads) (re-run its own loader)

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore, DEMO_ACCESS_TOKEN } from '@stores/auth.store';
import { API_BASE_URL } from '@lib/api';

// ── Connection URL ────────────────────────────────────────────────────
// The API and the frontend live on different hosts in production (Railway vs
// Vercel), so the socket follows API_BASE_URL — window.location.host would
// point it at the static site, where nothing is listening.
const resolveWsUrl = (token) => {
  let origin;
  try {
    origin = new URL(API_BASE_URL, window.location.origin).origin;
  } catch {
    origin = window.location.origin;
  }
  return `${origin.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
};

// ── Shared connection state ───────────────────────────────────────────
let socket = null;
let currentToken = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let attempt = 0;
let closedByUs = false;
let refreshing = null;

// The server closes with these when the token is missing, expired or not
// tenant-scoped (see websocket.middleware.js).
const AUTH_CLOSE_CODES = new Set([4001, 4003]);

// An access token outlives a page load but not a long session, and the socket
// captured the one it was opened with. Reconnecting with the same expired
// token just gets closed again — a tab parked on the pipeline makes no REST
// calls, so nothing else was there to trigger the axios 401 refresh and the
// socket stayed dead for the life of the tab. Refresh here instead: writing
// the new token to the store re-runs the effect below, which reopens the
// socket. Deliberately plain fetch — the axios instance's own 401 interceptor
// would recurse back into this path.
const refreshAccessToken = () => {
  if (refreshing) return refreshing;

  const { refreshToken, user, tenant, setAuth } = useAuthStore.getState();
  if (!refreshToken) return Promise.resolve(false);

  refreshing = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      const accessToken = body?.data?.accessToken;
      if (!accessToken) return false;
      setAuth({ accessToken, refreshToken, user, tenant });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
};

// eventType -> Set<handler>, module-level so mount order never matters.
const handlers = new Map();
// Notified whenever the connected/disconnected state changes.
const statusWatchers = new Set();

const setStatus = (connected) => {
  statusWatchers.forEach((fn) => { try { fn(connected); } catch { /* ignore */ } });
};

const emit = (type, data) => {
  const set = handlers.get(type);
  if (!set) return;
  set.forEach((fn) => {
    try { fn(data, type); } catch (err) { console.error('Real-time handler failed', err); }
  });
};

const stopHeartbeat = () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
};

// Proxies and load balancers close idle WebSockets (Railway's edge does around
// 60s). A periodic ping keeps it open; the server replies with a pong. Without
// this a tab left sitting open silently stops receiving updates — which looks
// exactly like the bug we set out to fix.
const startHeartbeat = () => {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: 'ping' })); } catch { /* closing */ }
    }
  }, 25000);
};

const scheduleReconnect = (token) => {
  if (closedByUs || reconnectTimer) return;
  // Backoff, so a backend restart or redeploy isn't hammered by every open tab.
  const delay = Math.min(1000 * 2 ** attempt, 30000);
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket(token);
  }, delay);
};

function openSocket(token) {
  if (!token || token === DEMO_ACCESS_TOKEN) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  closedByUs = false;
  currentToken = token;

  let ws;
  try {
    ws = new WebSocket(resolveWsUrl(token));
  } catch (err) {
    console.warn('Real-time: could not open socket', err);
    scheduleReconnect(token);
    return;
  }
  socket = ws;

  // Attached here, at creation. The listener must not live in its own effect
  // that returns early when the socket is not yet OPEN — that effect never
  // re-runs, so no message is ever handled.
  ws.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message?.type || message.type === 'pong') return;
    emit(message.type, message.data);
  };

  ws.onopen = () => {
    attempt = 0; // reset backoff only once a connection actually succeeded
    startHeartbeat();
    setStatus(true);
  };

  ws.onclose = (event) => {
    stopHeartbeat();
    if (socket === ws) socket = null;
    setStatus(false);
    if (closedByUs) return;

    if (AUTH_CLOSE_CODES.has(event?.code)) {
      // Don't reconnect with a token the server just rejected. A successful
      // refresh updates the store, and the effect reopens the socket for us.
      closedByUs = true;
      refreshAccessToken().then((ok) => {
        if (!ok) {
          // Refresh is gone too — stay down and let the next REST 401 send the
          // user to /auth, rather than looping on a dead credential.
          console.warn('Real-time: session expired, socket stopped');
        }
      });
      return;
    }

    scheduleReconnect(token);
  };

  ws.onerror = () => {
    // 'close' always follows; reconnect is handled there.
  };
}

const closeSocket = () => {
  closedByUs = true;
  stopHeartbeat();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  attempt = 0;
  currentToken = null;
  if (socket) {
    try { socket.close(1000, 'client closing'); } catch { /* already gone */ }
    socket = null;
  }
  setStatus(false);
};

// ── Hooks ─────────────────────────────────────────────────────────────

/**
 * Holds the shared connection open. Call once, high in the tree.
 * Returns { onEvent, connected }.
 */
export const useRealtimeSync = () => {
  const [connected, setConnected] = useState(() => socket?.readyState === WebSocket.OPEN);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    // A demo session's token is deliberately not a JWT, so the server would
    // reject it and the client would reconnect in a loop behind the demo.
    if (!token || token === DEMO_ACCESS_TOKEN) {
      closeSocket();
      return undefined;
    }
    if (currentToken && currentToken !== token) closeSocket();
    openSocket(token);
    return undefined;
  }, [token]);

  useEffect(() => {
    statusWatchers.add(setConnected);
    return () => { statusWatchers.delete(setConnected); };
  }, []);

  const onEvent = useCallback((eventType, handler) => {
    if (!handlers.has(eventType)) handlers.set(eventType, new Set());
    handlers.get(eventType).add(handler);
    return () => {
      const set = handlers.get(eventType);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) handlers.delete(eventType);
    };
  }, []);

  return { onEvent, connected };
};

/** Subscribe to one event type for the life of the component. */
export const useRealtimeEvent = (eventType, handler) => {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const fn = (data, type) => ref.current?.(data, type);
    if (!handlers.has(eventType)) handlers.set(eventType, new Set());
    handlers.get(eventType).add(fn);
    return () => {
      const set = handlers.get(eventType);
      if (!set) return;
      set.delete(fn);
      if (set.size === 0) handlers.delete(eventType);
    };
  }, [eventType]);
};

const LEAD_EVENTS = ['lead:updated', 'lead:stage-changed', 'leads:refresh', 'lead:note-added'];

/**
 * Re-runs `reload` when lead data changes anywhere.
 *
 * Calls are coalesced: one stage change emits both 'lead:stage-changed' and
 * 'leads:refresh', and the pipeline loader pages through the whole list, so
 * firing it once per event would double the work for no benefit.
 */
export const useRealtimeRefresh = (reload, events = LEAD_EVENTS) => {
  const ref = useRef(reload);
  ref.current = reload;

  // events is usually an inline array; key on contents, not identity.
  const key = events.join('|');

  useEffect(() => {
    let timer = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; ref.current?.(); }, 150);
    };

    const list = key.split('|');
    list.forEach((evt) => {
      if (!handlers.has(evt)) handlers.set(evt, new Set());
      handlers.get(evt).add(fire);
    });

    return () => {
      if (timer) clearTimeout(timer);
      list.forEach((evt) => {
        const set = handlers.get(evt);
        if (!set) return;
        set.delete(fire);
        if (set.size === 0) handlers.delete(evt);
      });
    };
  }, [key]);
};

/** Debug helper — current socket state without exposing the socket. */
export const realtimeStatus = () => ({
  connected: socket?.readyState === WebSocket.OPEN,
  readyState: socket?.readyState ?? null,
  retries: attempt,
});
