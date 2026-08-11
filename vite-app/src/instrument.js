// src/instrument.js
//
// Imported as the very first line of main.jsx, before React, before
// anything renders — see main.jsx for why. Mirrors backend/src/instrument.js
// for the same reason on the server side.
//
// Safe with no DSN configured: Sentry.init() no-ops every capture call when
// dsn is empty/undefined — documented SDK behavior. That matters right now:
// VITE_SENTRY_DSN does not exist on the asos-dashboard Railway service as
// of this commit, despite the task that asked for this integration
// assuming it already did. This ships inert until that's actually set.
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // import.meta.env.MODE is Vite's own 'development' | 'production', set
  // correctly by `vite build` vs `vite dev` — using the literal string
  // 'production' unconditionally would mislabel every error a developer
  // hits locally as a production incident, defeating the point of the tag.
  environment: import.meta.env.MODE,
  // No version/release ever existed for this app (package.json's version is
  // a static, never-bumped "1.0.0") — VITE_APP_VERSION is baked at build
  // time in vite-app/Dockerfile from Railway's own RAILWAY_GIT_COMMIT_SHA,
  // which is the only thing that actually changes per deploy.
  release: import.meta.env.VITE_APP_VERSION || undefined,
});

export default Sentry;
