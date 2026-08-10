// src/routes.manifest.js — the single list of paths this SPA answers on.
//
// Imported by two places that must never disagree:
//   - AppRoutes.jsx, which renders them
//   - vite.config.js, whose preview middleware returns a real HTTP 404 for
//     anything absent from this list
//
// Plain data with no JSX and no imports, so the Vite config can load it in
// Node directly. When you add a route to AppRoutes.jsx, add it here too or
// the deployed app will answer that URL with a 404 status.

// Reachable without a session. These are the only ones worth indexing.
export const PUBLIC_ROUTES = [
  '/',
  '/landing',
  '/auth',
  '/reset-password',
  '/privacy',
  '/terms',
];

// Behind <PrivateRoute>. They resolve for a signed-in user, so they must not
// 404, but robots.txt disallows them — there is no public content here.
export const APP_ROUTES = [
  '/admin',
  '/ads',
  '/ai-insights',
  '/analytics',
  '/automations',
  '/billing',
  '/conversations',
  '/dashboard',
  '/dsp-reports',
  '/leads',
  '/onboarding',
  '/settings',
  '/students',
];

export const ALL_ROUTES = [...PUBLIC_ROUTES, ...APP_ROUTES];
