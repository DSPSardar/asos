// src/test/setup.js — global test setup
import '@testing-library/jest-dom/vitest';

// jsdom implements neither matchMedia nor IntersectionObserver. Components
// that read prefers-reduced-motion (e.g. AgentPipeline) or gate animation
// on visibility need these to exist as no-ops so mounting them in tests
// doesn't throw. Real behavior is exercised manually in the browser per
// the task-4 brief; these stubs just let the render tree mount cleanly.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (typeof globalThis.IntersectionObserver !== 'function') {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.IntersectionObserver = MockIntersectionObserver;
  window.IntersectionObserver = MockIntersectionObserver;
}

// Node >=22 defines its own global `localStorage` accessor (a no-op stub
// unless the process is started with --localstorage-file). Vitest's jsdom
// environment sees that the host already provides `localStorage` and, by
// design, skips copying jsdom's working implementation over it — so
// window.localStorage is undefined here too, not just the bare identifier.
// auth.store.js's zustand `persist` middleware reads the bare identifier
// at import time, so without a real Storage every setState throws
// "Cannot read properties of undefined (reading 'setItem')". Replace the
// stub with a minimal in-memory Storage so persist has something to call.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
  const store = new Map();
  const memoryStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}
