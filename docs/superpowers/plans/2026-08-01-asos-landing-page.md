# ASOS Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, conversion-focused marketing landing page at the root of `https://dspagenthub.com`, decoupled from the auth form, linking into the existing signup flow.

**Architecture:** A new public `Landing` page inside the existing Vite SPA (`vite-app`), composed of focused presentational section components under `src/components/landing/`. The router is restructured so `/` is public (landing for logged-out visitors, redirect to the dashboard for logged-in ones) while every existing dashboard URL stays byte-identical via a pathless layout route. Styling reuses the app's existing Tailwind tokens and CSS utilities — no new design system.

**Tech Stack:** React 18, React Router v6, Tailwind CSS 3.4, Zustand, Vite 5. Tests: Vitest + React Testing Library + jsdom (new devDependencies, routing only).

**Spec:** `docs/superpowers/specs/2026-08-01-asos-landing-page-design.md`

## Global Constraints

These apply to **every** task. Do not restate them per task; they are always in force.

- **No new runtime dependencies.** Test tooling is `devDependencies` only. No landing component may import `axios`, `recharts`, `@anthropic-ai/sdk`, or `@stores/auth.store` (the sole exception is `PublicHome` in `main.jsx`, which needs the auth store to decide the redirect).
- **Vendor-neutral AI copy.** No text rendered on the page — or in any meta tag — may contain the words `Claude`, `Anthropic`, `GPT`, or `OpenAI`. Use "AI agents", "dual-agent AI engine", "Qualifier", "Closer". Rationale: the pipeline in `backend/src/services/claude.service.js:11,17` instantiates the OpenAI SDK with `OPENAI_MODEL` defaulting to `gpt-5.4-mini` (`backend/src/config/env.js:33`), so a "Claude AI" claim would be false.
- **No fabricated live data.** The animated section carries a persistent `SIMULATED DEMO` label. No relative timestamps ("2s ago"), no live counters, no invented customer names, no wording implying real-time production traffic.
- **Reuse existing tokens only.** Colors, fonts, radii and utilities come from `vite-app/tailwind.config.js` and `vite-app/src/index.css`. Do **not** modify `tailwind.config.js`. Do not introduce new hex values beyond those listed below.
- **CTA hrefs are relative.** Always `/auth?tab=register` — never an absolute domain. Absolute `https://dspagenthub.com` URLs appear only in the SEO tags in Task 7.
- **Contrast floor.** Body and label text uses `slate-300` or `slate-400` minimum on the `#030712` background. Never `slate-500`/`600`/`700` for text a user needs to read.
- **Dashboard URLs are frozen.** These 13 paths must keep resolving exactly as they do today: `/dashboard`, `/leads`, `/conversations`, `/ai-insights`, `/ads`, `/analytics`, `/settings`, `/billing`, `/onboarding`, `/students`, `/dsp-reports`, `/automations`, `/admin`.

### Token reference (copy these exact values)

| Purpose | Value |
|---|---|
| Page background | `#030712` — Tailwind class `bg-bg` |
| Card surface | `rgba(15,23,42,0.6)` via `.glass-card`, or `.glass` for stronger panels |
| Accent / accent2 | `#6366f1` / `#8b5cf6` — classes `accent` / `accent2` |
| Primary button | Use `<CtaButton>` (Task 2). It owns `linear-gradient(135deg,#6366f1,#8b5cf6)` + `boxShadow: '0 4px 24px rgba(99,102,241,0.3)'` — never re-declare these elsewhere. |
| Eyebrow label | Use `<Eyebrow>` (Task 2). It owns `text-xs font-semibold text-indigo-400 uppercase tracking-widest font-mono`. |
| Logo mark | Use `<LogoMark>` (Task 2). |
| Gradient headline text | class `.gradient-text` |
| Fonts | `font-sans` (Space Grotesk), `font-mono` (JetBrains Mono) — already loaded |
| Radii | `rounded-xl` controls, `rounded-2xl` cards, `rounded-3xl` large panels |
| Section rhythm | `py-20 md:py-28`, container `max-w-6xl mx-auto px-6` |

### Pre-existing repo conditions (not caused by your changes)

- `npm run lint` may fail because ESLint 9 is installed but no `eslint.config.js` exists in `vite-app/`. If lint fails **before** you make changes, it is pre-existing — note it and move on. Do not add an ESLint config as part of this work.
- All commands below run from `vite-app/` unless stated otherwise.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `vite-app/src/AppRoutes.jsx` | The route tree as a pure, side-effect-free module |
| `vite-app/vitest.config.js` | Test runner config (jsdom, aliases mirroring `vite.config.js`) |
| `vite-app/src/test/setup.js` | Test setup — jest-dom matchers |
| `vite-app/src/routes.test.jsx` | Router tests: public `/`, redirects, all 13 dashboard paths |
| `vite-app/src/pages/Landing.jsx` | Page shell — landmarks, composes sections |
| `vite-app/src/components/landing/links.js` | CTA targets + brand constants |
| `vite-app/src/components/landing/CtaButton.jsx` | The one call-to-action button (primary + secondary variants) |
| `vite-app/src/components/landing/Eyebrow.jsx` | The small mono uppercase section label |
| `vite-app/src/components/landing/LogoMark.jsx` | Gradient logo square + brand name |
| `vite-app/src/components/landing/LandingNav.jsx` | Sticky nav |
| `vite-app/src/components/landing/Hero.jsx` | Headline, subhead, dual CTA |
| `vite-app/src/components/landing/StatsBar.jsx` | 78% / 11.1% / 5.68x |
| `vite-app/src/components/landing/HowItWorks.jsx` | 4 steps |
| `vite-app/src/components/landing/Features.jsx` | 3-column feature grid |
| `vite-app/src/components/landing/AgentPipeline.jsx` | Animated qualification replay |
| `vite-app/src/components/landing/Pricing.jsx` | 4 tiers + monthly/yearly toggle |
| `vite-app/src/components/landing/Faq.jsx` | `<details>` accordion |
| `vite-app/src/components/landing/FinalCta.jsx` | Closing trial offer |
| `vite-app/src/components/landing/LandingFooter.jsx` | Footer nav + trust badges |
| `vite-app/public/og-cover.png` | 1200×630 social preview image |
| `vite-app/scripts/make-og-cover.py` | Reproducible generator for the above |

**Modified:**

| File | Change |
|---|---|
| `vite-app/package.json` | Add `test` script + 4 devDependencies |
| `vite-app/src/main.jsx` | Slimmed to the entry point; route tree moves to `AppRoutes.jsx` |
| `vite-app/index.html` | SEO/OG tags, `lang="en"` |

**Task order rationale:** Task 1 lands the risky routing change behind tests first, with a stub `Landing`. Tasks 2–6 fill in sections top-to-bottom, each independently viewable in the browser. Task 7 finishes with SEO and the OG asset.

---

## Task 1: Test harness + public routing

The highest-risk change in this plan. Making `/` public means restructuring the route tree that every dashboard URL hangs off. Tests come first and exist specifically to prove those 13 URLs still resolve.

**Files:**
- Modify: `vite-app/package.json`
- Create: `vite-app/vitest.config.js`
- Create: `vite-app/src/test/setup.js`
- Create: `vite-app/src/routes.test.jsx`
- Create: `vite-app/src/pages/Landing.jsx` (stub — filled in by Tasks 2–6)
- Create: `vite-app/src/components/landing/links.js`
- Create: `vite-app/src/AppRoutes.jsx`
- Modify: `vite-app/src/main.jsx`

**Interfaces:**
- Produces: `AppRoutes` — **named** export from `src/AppRoutes.jsx`, the `<Routes>` tree with no `BrowserRouter` around it, so tests can wrap it in `MemoryRouter`.

  The route tree lives in its own module rather than in `main.jsx` because `main.jsx` calls `ReactDOM.createRoot(...)` at module scope. Importing it from a test would execute that call — either crashing on a missing `#root`, or (if the test supplies one) mounting the entire real app into the document so that every `screen` query matches both the mounted app and the test's own render. `AppRoutes.jsx` must therefore stay free of top-level side effects: no `ReactDOM`, no `./index.css`.
- Produces: `Landing` — default export from `src/pages/Landing.jsx`.
- Produces: from `src/components/landing/links.js` — `SIGNUP_HREF: string`, `LOGIN_HREF: string`, `BRAND_NAME: string`, `SALES_EMAIL: string`, `NAV_LINKS: Array<{href: string, label: string}>`.

- [ ] **Step 1: Install test dependencies**

```bash
npm install --save-dev vitest@^2.1.8 @testing-library/react@^16.1.0 @testing-library/jest-dom@^6.6.3 jsdom@^25.0.1
```

Expected: 4 packages added under `devDependencies`. No changes to `dependencies`.

- [ ] **Step 2: Add the test script**

In `vite-app/package.json`, add `"test"` to `scripts` so the block reads:

```json
  "scripts": {
    "dev": "vite --port 3001",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint src/",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Create the Vitest config**

Create `vite-app/vitest.config.js`. The aliases must mirror `vite.config.js:12-18` exactly, or imports like `@stores/auth.store` fail to resolve under test.

```js
// vitest.config.js — test runner config (aliases mirror vite.config.js)
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@':           path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages':      path.resolve(__dirname, './src/pages'),
      '@lib':        path.resolve(__dirname, './src/lib'),
      '@stores':     path.resolve(__dirname, './src/stores'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
});
```

- [ ] **Step 4: Create the test setup file**

Create `vite-app/src/test/setup.js`:

```js
// src/test/setup.js — global test setup
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Create the links module**

Create `vite-app/src/components/landing/links.js`. Env fallbacks mirror `src/pages/Auth.jsx:9-11` so branding matches between the two pages.

```js
// src/components/landing/links.js — CTA targets and brand constants.
//
// SIGNUP_HREF uses ?tab=register because that is the parameter Auth.jsx
// actually reads (see src/pages/Auth.jsx:37). Any other value silently
// lands the visitor on the Sign In tab.

export const SIGNUP_HREF = '/auth?tab=register';
export const LOGIN_HREF  = '/auth';

export const BRAND_NAME  = import.meta.env.VITE_BRAND_NAME  || 'ASOS';
export const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL || 'info@digitalservicesprogram.com';

export const NAV_LINKS = [
  { href: '#how',      label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#demo',     label: 'See it work' },
  { href: '#pricing',  label: 'Pricing' },
  { href: '#faq',      label: 'FAQ' },
];
```

- [ ] **Step 6: Create the Landing stub**

Create `vite-app/src/pages/Landing.jsx`. Tasks 2–6 replace the body; the `<main>` landmark and heading exist now so routing tests have something stable to assert on.

```jsx
// src/pages/Landing.jsx — public marketing landing page.
import React from 'react';

export default function Landing() {
  return (
    <main className="min-h-screen bg-bg text-slate-100">
      <h1>Close deals while you sleep.</h1>
    </main>
  );
}
```

- [ ] **Step 7: Write the failing routing tests**

Create `vite-app/src/routes.test.jsx`. These assert the three things that could break: the landing renders publicly, logged-in users are redirected away from `/`, and all 13 dashboard paths still resolve.

```jsx
// src/routes.test.jsx — routing contract.
//
// Guards the restructure that made "/" public. The dashboard URL list
// below is frozen: if a path disappears, existing customers get a blank
// screen, so these tests must fail loudly rather than be updated.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './AppRoutes';
import { useAuthStore } from '@stores/auth.store';

// Replace the dashboard shell with a bare marker. Deliberately NO
// <Outlet />: without one, the 13 child pages never mount, so these
// tests stay fast and no page fires an API call into jsdom. What is
// under test is which path resolves to the authenticated shell — not
// what any individual page renders.
vi.mock('@pages/Layout', () => ({
  default: () => <div data-testid="shell" />,
}));

const DASHBOARD_PATHS = [
  '/dashboard', '/leads', '/conversations', '/ai-insights', '/ads',
  '/analytics', '/settings', '/billing', '/onboarding', '/students',
  '/dsp-reports', '/automations', '/admin',
];

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <React.Suspense fallback={<div data-testid="loading" />}>
        <AppRoutes />
      </React.Suspense>
    </MemoryRouter>
  );
}

function loginAs(role) {
  useAuthStore.setState({
    token: 'test-token',
    user: { id: 'u1', email: 'a@b.c', fullName: 'Test', role },
    tenant: { id: 't1', slug: 'test' },
    ready: true,
  });
}

describe('routing', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null, tenant: null, ready: true });
  });

  it('renders the landing page at / when logged out', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      /close deals while you sleep/i
    );
  });

  it('renders the landing page at /landing when logged out', async () => {
    renderAt('/landing');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      /close deals while you sleep/i
    );
  });

  it('redirects a logged-in tenant user from / to the dashboard', async () => {
    loginAs('TENANT_ADMIN');
    renderAt('/');
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: /close deals/i })).toBeNull();
  });

  it('sends a logged-out visitor at an unknown path to the landing page', async () => {
    renderAt('/no-such-page');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      /close deals while you sleep/i
    );
  });

  it.each(DASHBOARD_PATHS)('keeps %s behind the authenticated shell', async (path) => {
    loginAs(path === '/admin' ? 'SUPERADMIN' : 'TENANT_ADMIN');
    renderAt(path);
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it.each(DASHBOARD_PATHS)('does not expose %s to a logged-out visitor', async (path) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId('shell')).toBeNull();
  });
});
```

Note on the last block: a logged-out visitor hitting a dashboard path is redirected by `PrivateRoute` to `/auth`, which renders its own `<h1>`-less form — so the assertion is simply that no shell appears. `findByRole('heading')` there tolerates either the auth page or the landing page rendering.

- [ ] **Step 8: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL. `src/AppRoutes.jsx` does not exist yet, so every test errors with `Failed to resolve import "./AppRoutes"`.

- [ ] **Step 9: Restructure the router**

The route tree moves out of `main.jsx` into a new `src/AppRoutes.jsx`, leaving `main.jsx` as a thin entry point that owns the side effects (CSS import, `createRoot`). See the Interfaces note above for why.

**Move into `vite-app/src/AppRoutes.jsx`, unchanged:** the eager `AdminPanelPage` import, every `React.lazy(...)` page constant, and the `PrivateRoute`, `DefaultRedirect`, `SuperAdminRoute` and `TenantRoute` guards. That file imports only `React`, `{ Routes, Route, Navigate }` from `react-router-dom`, and `{ useAuthStore }` from `@stores/auth.store`.

**`vite-app/src/main.jsx` keeps:** `ErrorBoundary`, `AuthInitializer`, the `Suspense` wrapper, `GOOGLE_CLIENT_ID` / `AppWithAuth`, `import './index.css'`, and the `createRoot` call. Add `import { AppRoutes } from './AppRoutes';` and reduce its `react-router-dom` import to just `BrowserRouter`.

Then, in `AppRoutes.jsx`:

**9a.** Add the eager `Landing` import alongside the eager `AdminPanel` import. It is eager, not lazy — this is the paid-traffic entry point and a lazy chunk costs a round trip before LCP.

```jsx
// AdminPanel is imported eagerly — no lazy chunk to fail
import AdminPanelPage from '@pages/AdminPanel';
// Landing is eager too: it is the entry point for paid traffic, so a
// lazy chunk would add a round trip before the largest paint.
import LandingPage from '@pages/Landing';
```

**9b.** Add `PublicHome` immediately after the `TenantRoute` definition (after line 96):

```jsx
// "/" is public. A visitor with no session sees the marketing page; a
// signed-in user is sent straight to their workspace.
const PublicHome = () => {
  const { token, user } = useAuthStore();
  if (!token) return <LandingPage />;
  return <Navigate to={user?.role === 'SUPERADMIN' ? '/admin' : '/dashboard'} replace />;
};

// Unknown paths: signed-in users land in their workspace, everyone else
// gets the marketing page rather than a bare login form.
const NotFoundRedirect = () => {
  const { token } = useAuthStore();
  if (!token) return <Navigate to="/" replace />;
  return <DefaultRedirect />;
};
```

**9c.** Define the exported `AppRoutes` component, converting the dashboard shell to a **pathless layout route** with absolute child paths:

```jsx
// Exported without a Router around it so tests can mount it inside a
// MemoryRouter. The app mounts it inside BrowserRouter below.
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/"         element={<PublicHome />} />
      <Route path="/landing"  element={<LandingPage />} />
      <Route path="/auth"     element={<AuthPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Pathless layout route: children keep their absolute URLs, so
          every dashboard path below is unchanged from before "/" became
          public. Do not convert these back to relative paths. */}
      <Route element={<PrivateRoute><DashboardLayout /></PrivateRoute>}>
        <Route path="/dashboard"     element={<TenantRoute><DashboardPage /></TenantRoute>}      />
        <Route path="/leads"         element={<TenantRoute><PipelinePage /></TenantRoute>}       />
        <Route path="/conversations" element={<TenantRoute><ConversationsPage /></TenantRoute>}  />
        <Route path="/ai-insights"   element={<TenantRoute><AIInsightsPage /></TenantRoute>}     />
        <Route path="/ads"           element={<TenantRoute><AdsPage /></TenantRoute>}            />
        <Route path="/analytics"     element={<TenantRoute><AnalyticsPage /></TenantRoute>}      />
        <Route path="/settings"      element={<TenantRoute><SettingsPage /></TenantRoute>}       />
        <Route path="/billing"       element={<TenantRoute><BillingPage /></TenantRoute>}        />
        <Route path="/onboarding"    element={<TenantRoute><OnboardingPage /></TenantRoute>}     />
        <Route path="/students"      element={<TenantRoute><StudentsPage /></TenantRoute>}       />
        <Route path="/dsp-reports"   element={<TenantRoute><DSPReportsPage /></TenantRoute>}     />
        <Route path="/automations"   element={<TenantRoute><AutomationsPage /></TenantRoute>}    />

        {/* SUPERADMIN only */}
        <Route path="/admin" element={<SuperAdminRoute><AdminPanelPage /></SuperAdminRoute>} />
      </Route>

      <Route path="*" element={<NotFoundRedirect />} />
    </Routes>
  );
}
```

**9d.** In `main.jsx`, the render call now uses the imported component:

```jsx
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
    <AppWithAuth>
    <BrowserRouter>
      {/* AuthInitializer hits /auth/me before rendering anything */}
      <AuthInitializer>
        <Suspense>
          <AppRoutes />
        </Suspense>
      </AuthInitializer>
    </BrowserRouter>
    </AppWithAuth>
    </ErrorBoundary>
  </React.StrictMode>
);
```

The `index` route that used to render `DefaultRedirect` is gone — `/` is now handled by `PublicHome`.

- [ ] **Step 10: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS — 30 tests (4 standalone + 13 + 13 from the two `it.each` blocks).

- [ ] **Step 11: Verify the build and the running app**

```bash
npm run build
```

Expected: build succeeds, no unresolved-import errors.

This step split the app's entry point, so also confirm the refactor is behaviour-neutral at runtime:

```bash
npm run dev
```

Open `http://localhost:3001/auth` and confirm the auth page still renders.

- [ ] **Step 12: Commit**

```bash
git add vite-app/package.json vite-app/package-lock.json vite-app/vitest.config.js \
        vite-app/src/test/setup.js vite-app/src/routes.test.jsx \
        vite-app/src/pages/Landing.jsx vite-app/src/components/landing/links.js \
        vite-app/src/AppRoutes.jsx vite-app/src/main.jsx
git commit -m "feat(landing): make / public and add routing tests

Converts the dashboard shell to a pathless layout route so every
existing dashboard URL is preserved byte-for-byte while / becomes the
public marketing page. Adds Vitest + RTL covering all 13 dashboard
paths against regression."
```

---

## Task 2: Shared primitives, nav, hero and stats bar

Everything above the fold, plus the three shared primitives every later task builds on. After this task the page is worth looking at in a browser.

**Files:**
- Create: `vite-app/src/components/landing/CtaButton.jsx`
- Create: `vite-app/src/components/landing/Eyebrow.jsx`
- Create: `vite-app/src/components/landing/LogoMark.jsx`
- Create: `vite-app/src/components/landing/LandingNav.jsx`
- Create: `vite-app/src/components/landing/Hero.jsx`
- Create: `vite-app/src/components/landing/StatsBar.jsx`
- Modify: `vite-app/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: `SIGNUP_HREF`, `LOGIN_HREF`, `BRAND_NAME`, `NAV_LINKS` from `@components/landing/links` (Task 1).
- Produces, and **every later task must use these rather than re-declaring their styles**:
  - `CtaButton({ href, variant, size, className, children })` — default export. `variant`: `'primary'` (default, gradient + glow) | `'secondary'` (outlined). `size`: `'sm'` | `'md'` (default) | `'lg'`. Renders an `<a>`.
  - `Eyebrow({ as, className, children })` — default export. `as` defaults to `'p'`; pass `'div'` when the label needs to contain inline elements.
  - `LogoMark({ withName, glow })` — default export. Both props default to `false`/`true` as declared below.
- Produces: `LandingNav`, `Hero`, `StatsBar` — default exports, no props.

- [ ] **Step 1: Create the three shared primitives**

These exist so the brand's button, label and logo are defined once. Later tasks import them; no other component may re-declare the gradient, the eyebrow class string, or the logo square.

Create `vite-app/src/components/landing/CtaButton.jsx`:

```jsx
// src/components/landing/CtaButton.jsx — the landing page's call-to-action
// button. Defined once so a brand change is a one-file edit.
import React from 'react';

const SIZES = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-3 text-sm',
  lg: 'px-8 py-4 text-base',
};

const BASE =
  'inline-block text-center rounded-xl font-semibold transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2';

const PRIMARY_STYLE = {
  background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
  boxShadow: '0 4px 24px rgba(99,102,241,0.3)',
};

export default function CtaButton({
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
}) {
  const isPrimary = variant === 'primary';
  const variantClasses = isPrimary
    ? 'text-white focus-visible:ring-indigo-300'
    : 'text-slate-200 border border-indigo-500/25 bg-slate-900/60 hover:border-indigo-400/50 hover:text-white focus-visible:ring-indigo-400';

  return (
    <a
      href={href}
      className={`${BASE} ${SIZES[size]} ${variantClasses} ${className}`}
      style={isPrimary ? PRIMARY_STYLE : undefined}
    >
      {children}
    </a>
  );
}
```

Create `vite-app/src/components/landing/Eyebrow.jsx`:

```jsx
// src/components/landing/Eyebrow.jsx — small mono uppercase section label.
// Mirrors the treatment used on the auth page (src/pages/Auth.jsx:362).
import React from 'react';

export default function Eyebrow({ as: Tag = 'p', className = '', children }) {
  return (
    <Tag
      className={`text-xs font-semibold text-indigo-400 uppercase tracking-widest font-mono ${className}`}
    >
      {children}
    </Tag>
  );
}
```

Create `vite-app/src/components/landing/LogoMark.jsx`:

```jsx
// src/components/landing/LogoMark.jsx — gradient logo square, optionally
// followed by the brand name.
import React from 'react';
import { BRAND_NAME } from './links';

export default function LogoMark({ withName = true, glow = false }) {
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold ${glow ? 'glow-accent' : ''}`}
        style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
      >
        A
      </span>
      {withName && (
        <span className="text-base font-bold text-white tracking-tight">{BRAND_NAME}</span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Create the nav**

Create `vite-app/src/components/landing/LandingNav.jsx`:

```jsx
// src/components/landing/LandingNav.jsx — sticky top navigation.
import React from 'react';
import CtaButton from './CtaButton';
import LogoMark from './LogoMark';
import { LOGIN_HREF, NAV_LINKS, SIGNUP_HREF } from './links';

export default function LandingNav() {
  return (
    <header
      className="sticky top-0 z-50 border-b border-indigo-500/10 backdrop-blur-xl"
      style={{ background: 'rgba(3,7,18,0.88)' }}
    >
      <nav
        aria-label="Main"
        className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-6"
      >
        <a href="/" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
          <LogoMark glow />
        </a>

        <ul className="hidden md:flex items-center gap-1 ml-auto">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 ml-auto md:ml-0">
          <a
            href={LOGIN_HREF}
            className="hidden sm:block px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Sign in
          </a>
          <CtaButton href={SIGNUP_HREF} size="sm" className="whitespace-nowrap">
            Start free trial
          </CtaButton>
        </div>
      </nav>
    </header>
  );
}
```

- [ ] **Step 3: Create the hero**

Create `vite-app/src/components/landing/Hero.jsx`. Note the subheadline is vendor-neutral per the global constraints.

```jsx
// src/components/landing/Hero.jsx — above-the-fold pitch.
import React from 'react';
import CtaButton from './CtaButton';
import Eyebrow from './Eyebrow';
import { SIGNUP_HREF } from './links';

export default function Hero() {
  return (
    <section className="relative overflow-hidden grid-bg" aria-labelledby="hero-heading">
      {/* Decorative background orbs — mirror the /auth page treatment. */}
      <div
        aria-hidden="true"
        className="absolute -top-32 -left-24 w-96 h-96 rounded-full pointer-events-none opacity-20"
        style={{ background: 'radial-gradient(circle,#6366f1,transparent 70%)', filter: 'blur(80px)' }}
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 -right-24 w-80 h-80 rounded-full pointer-events-none opacity-15"
        style={{ background: 'radial-gradient(circle,#8b5cf6,transparent 70%)', filter: 'blur(80px)' }}
      />

      <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-20 text-center">
        <Eyebrow className="mb-5">The Future of Sales</Eyebrow>

        <h1
          id="hero-heading"
          className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.1] tracking-tight text-white mb-6"
        >
          Close deals while
          <br />
          <span className="gradient-text">you sleep.</span>
        </h1>

        <p className="max-w-2xl mx-auto text-lg md:text-xl text-slate-300 leading-relaxed mb-10">
          AI agents qualify every lead, diagnose their problem, and send the perfect
          WhatsApp message — automatically.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
          <CtaButton href={SIGNUP_HREF} size="lg" className="w-full sm:w-auto">
            Start free trial →
          </CtaButton>
          <CtaButton href="#demo" variant="secondary" size="lg" className="w-full sm:w-auto">
            Watch the agents work
          </CtaButton>
        </div>

        <p className="text-sm text-slate-400">
          14-day free trial · No credit card required · Cancel anytime
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create the stats bar**

Create `vite-app/src/components/landing/StatsBar.jsx`:

```jsx
// src/components/landing/StatsBar.jsx — headline performance numbers.
import React from 'react';

const STATS = [
  { value: '78%',   label: 'AI handling rate' },
  { value: '11.1%', label: 'Conversion rate' },
  { value: '5.68x', label: 'Average ROAS' },
];

export default function StatsBar() {
  return (
    <section aria-label="Performance highlights" className="relative">
      <div className="max-w-6xl mx-auto px-6 pb-16 md:pb-20">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="glass-card rounded-2xl px-6 py-8 text-center"
            >
              <dt className="sr-only">{stat.label}</dt>
              <dd>
                <span className="block text-4xl md:text-5xl font-bold font-mono gradient-text">
                  {stat.value}
                </span>
                <span className="block mt-2 text-sm text-slate-400">{stat.label}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Wire them into the page**

Replace the whole body of `vite-app/src/pages/Landing.jsx`:

```jsx
// src/pages/Landing.jsx — public marketing landing page.
//
// Composed of focused section components. Sections are ordered as a
// sales argument: promise -> proof -> mechanism -> demonstration ->
// price -> objections -> ask.
import React from 'react';
import LandingNav from '@components/landing/LandingNav';
import Hero from '@components/landing/Hero';
import StatsBar from '@components/landing/StatsBar';

export default function Landing() {
  return (
    <div className="min-h-screen bg-bg text-slate-100 font-sans overflow-x-clip">
      <LandingNav />
      <main>
        <Hero />
        <StatsBar />
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Confirm routing tests still pass**

```bash
npm test
```

Expected: PASS, 30 tests. The `<h1>` assertion still matches because `Hero` renders "Close deals while you sleep."

- [ ] **Step 7: Look at it**

```bash
npm run dev
```

Open `http://localhost:3001/`. Confirm: no login form anywhere, the nav sticks on scroll, both CTAs are visible without scrolling on a 1280×800 viewport, and "Start free trial" navigates to `/auth` with the **Get Started** tab active.

- [ ] **Step 8: Commit**

```bash
git add vite-app/src/components/landing vite-app/src/pages/Landing.jsx
git commit -m "feat(landing): add shared primitives, nav, hero and stats bar"
```

---

## Task 3: How it works and feature breakdown

**Files:**
- Create: `vite-app/src/components/landing/HowItWorks.jsx`
- Create: `vite-app/src/components/landing/Features.jsx`
- Modify: `vite-app/src/pages/Landing.jsx`

**Interfaces:**
- Produces: `HowItWorks`, `Features` — default exports, no props. Render sections with `id="how"` and `id="features"` respectively, matching `NAV_LINKS` anchors from Task 1.

- [ ] **Step 1: Create the how-it-works section**

Create `vite-app/src/components/landing/HowItWorks.jsx`:

```jsx
// src/components/landing/HowItWorks.jsx — the four-step mechanism.
import React from 'react';
import Eyebrow from './Eyebrow';

const STEPS = [
  {
    n: '01',
    title: 'A lead comes in',
    body: 'From a Meta ad, a WhatsApp message, or an organic signup. Every lead lands in one pipeline.',
  },
  {
    n: '02',
    title: 'AI qualifies and diagnoses',
    body: 'The Qualifier agent scores buying intent and writes down the real problem behind the enquiry.',
  },
  {
    n: '03',
    title: 'A personalised WhatsApp goes out',
    body: 'The Closer agent writes and sends the reply, grounded strictly in the facts you configured.',
  },
  {
    n: '04',
    title: 'The deal closes, tracked end to end',
    body: 'Stage advances, activity is logged, and conversions fire server-side so your ad reporting stays accurate.',
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how"
      aria-labelledby="how-heading"
      className="border-y border-indigo-500/10"
      style={{ background: 'rgba(99,102,241,0.025)' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-14">
          <Eyebrow className="mb-4">How it works</Eyebrow>
          <h2 id="how-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            From ad click to <span className="gradient-text">closed deal</span>
          </h2>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((step) => (
            <li key={step.n} className="glass-card rounded-2xl p-6">
              <span className="block text-sm font-mono font-semibold text-indigo-400 mb-3">
                {step.n}
              </span>
              <h3 className="text-base font-semibold text-slate-100 mb-2">{step.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create the features section**

Create `vite-app/src/components/landing/Features.jsx`:

```jsx
// src/components/landing/Features.jsx — three-column capability breakdown.
import React from 'react';
import Eyebrow from './Eyebrow';

const FEATURES = [
  {
    icon: '◎',
    title: 'Dual-Agent AI Engine',
    body: 'A Qualifier agent scores and diagnoses every lead. A Closer agent writes the reply — working only from the facts you configure, with unauthorised discounts and out-of-scope offers blocked before they send.',
  },
  {
    icon: '◈',
    title: 'Multi-tenant CRM',
    body: 'A full pipeline, contacts, and an activity trail on every lead. Every record is scoped to your workspace, so agencies can run many clients side by side.',
  },
  {
    icon: '⬗',
    title: 'Meta Ads Attribution',
    body: 'Server-side Conversions API events fire as leads progress, so your ad reporting reflects real revenue instead of whatever survived the browser.',
  },
];

export default function Features() {
  return (
    <section id="features" aria-labelledby="features-heading">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-14">
          <Eyebrow className="mb-4">What you get</Eyebrow>
          <h2 id="features-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            Everything your sales team <span className="gradient-text">forgets to do</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="glass-card rounded-2xl p-7">
              <span
                aria-hidden="true"
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl mb-5"
                style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
              >
                {feature.icon}
              </span>
              <h3 className="text-lg font-semibold text-slate-100 mb-3">{feature.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add both to the page**

In `vite-app/src/pages/Landing.jsx`, add the imports and render them after `StatsBar`:

```jsx
import HowItWorks from '@components/landing/HowItWorks';
import Features from '@components/landing/Features';
```

```jsx
      <main>
        <Hero />
        <StatsBar />
        <HowItWorks />
        <Features />
      </main>
```

- [ ] **Step 4: Verify**

```bash
npm test && npm run build
```

Expected: 30 tests PASS, build succeeds.

Then with `npm run dev` running, click the "How it works" and "Features" nav links and confirm both scroll to the right section.

- [ ] **Step 5: Commit**

```bash
git add vite-app/src/components/landing vite-app/src/pages/Landing.jsx
git commit -m "feat(landing): add how-it-works and feature sections"
```

---

## Task 4: Animated agent pipeline

The conversion centerpiece. A visitor watches one qualification run end to end instead of reading about it.

Field names and value sets come verbatim from `backend/src/services/claude.service.js` (`QUALIFIER_SCHEMA` at line 50, `CLOSER_SCHEMA` at line 228) so the animation doubles as accurate product documentation.

**Two score scales appear, deliberately.** The Qualifier returns `score` on a **1–10** scale (`claude.service.js:55`); `Lead.aiScore` is stored out of **100** (`claude.service.js:153`). The card shows `9/10`, the CRM row shows `91/100`. They are different fields. Label them distinctly — do not "fix" one to match the other.

**Files:**
- Create: `vite-app/src/components/landing/AgentPipeline.jsx`
- Modify: `vite-app/src/pages/Landing.jsx`

**Interfaces:**
- Produces: `AgentPipeline` — default export, no props. Renders a section with `id="demo"`.

- [ ] **Step 1: Create the animated pipeline**

Create `vite-app/src/components/landing/AgentPipeline.jsx`.

Design notes that matter for correctness:
- One `setTimeout` chain driven by a step index, cleared on unmount — no interval leaks, no stacked timers when scrolling in and out.
- An `IntersectionObserver` pauses the loop off-screen so it costs nothing while the rest of the page is read.
- Every stage container has a **fixed min-height** so populating content causes no layout shift.
- Under `prefers-reduced-motion: reduce` the animation never starts and the final state renders immediately — nothing is conveyed by motion alone.
- The typed text container is `aria-live="off"` with the full message also present for assistive tech, so a screen reader announces the finished sentence once rather than per character.

```jsx
// src/components/landing/AgentPipeline.jsx — animated replay of one lead
// qualification.
//
// This is a SIMULATED demo on a fixed script. It never represents real
// customer traffic and must never be relabelled to imply that it does.
//
// Field names mirror the live agent contract so the animation doubles as
// documentation:
//   Qualifier -> backend/src/services/claude.service.js:50  (QUALIFIER_SCHEMA)
//   Closer    -> backend/src/services/claude.service.js:228 (CLOSER_SCHEMA)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Eyebrow from './Eyebrow';

const INBOUND_MESSAGE =
  "We get maybe 200 enquiries a month but my team only calls back about 30 of them. The rest just go cold.";

// Qualifier `score` is 1-10 (claude.service.js:55). Lead.aiScore is /100
// (claude.service.js:153). Both are shown, labelled distinctly.
const QUALIFIER_FIELDS = [
  { key: 'lead_status',     value: 'HOT',                                                            tone: 'hot'  },
  { key: 'score',           value: '9/10',                                                           tone: 'plain' },
  { key: 'intent',          value: 'high',                                                           tone: 'plain' },
  { key: 'problem_summary', value: '170 enquiries a month go unworked because follow-up is manual.',  tone: 'plain' },
  { key: 'next_action',     value: 'send_proposal',                                                  tone: 'accent' },
];

const CLOSER_REPLY =
  'Based on your answers, I can see this is costing you ~$40k/month in lost leads. Let me show you how we fix this…';

const STAGES = ['NEW', 'QUALIFYING', 'DIAGNOSED'];

// Step timeline. Total ~12s, then a 2s hold before looping.
const TYPING_MS = 22;           // per character
const FIELD_INTERVAL_MS = 800;  // between Qualifier fields
const HOLD_MS = 2000;

export default function AgentPipeline() {
  // step: 0 idle -> 1 inbound -> 2 qualifier -> 3 closer -> 4 crm -> 5 hold
  const [step, setStep]           = useState(0);
  const [fieldCount, setFieldCnt] = useState(0);
  const [typed, setTyped]         = useState('');
  const [stageIdx, setStageIdx]   = useState(0);
  const [score, setScore]         = useState(0);
  const [reduced, setReduced]     = useState(false);

  const sectionRef = useRef(null);
  const timers     = useRef([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const after = useCallback((ms, fn) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // Jump straight to the finished state — used for reduced motion and as
  // the resting state after each loop.
  const showFinalState = useCallback(() => {
    clearTimers();
    setStep(4);
    setFieldCnt(QUALIFIER_FIELDS.length);
    setTyped(CLOSER_REPLY);
    setStageIdx(STAGES.length - 1);
    setScore(91);
  }, [clearTimers]);

  const runCycle = useCallback(() => {
    clearTimers();
    setStep(1);
    setFieldCnt(0);
    setTyped('');
    setStageIdx(0);
    setScore(0);

    // Step 2 — Qualifier fields populate one at a time.
    after(1600, () => {
      setStep(2);
      QUALIFIER_FIELDS.forEach((_, i) => {
        after(1600 + i * FIELD_INTERVAL_MS, () => setFieldCnt(i + 1));
      });
    });

    const qualifierDone = 1600 + QUALIFIER_FIELDS.length * FIELD_INTERVAL_MS;

    // Step 3 — Closer types its reply.
    after(qualifierDone, () => {
      setStep(3);
      for (let i = 1; i <= CLOSER_REPLY.length; i += 1) {
        after(qualifierDone + i * TYPING_MS, () => setTyped(CLOSER_REPLY.slice(0, i)));
      }
    });

    const closerDone = qualifierDone + CLOSER_REPLY.length * TYPING_MS + 400;

    // Step 4 — CRM stage advances and the lead score counts up.
    after(closerDone, () => {
      setStep(4);
      STAGES.forEach((_, i) => after(closerDone + i * 420, () => setStageIdx(i)));
      for (let v = 0; v <= 91; v += 7) {
        after(closerDone + 300 + (v / 7) * 45, () => setScore(Math.min(v, 91)));
      }
      after(closerDone + 300 + 14 * 45, () => setScore(91));
    });

    // Loop.
    after(closerDone + 2200 + HOLD_MS, runCycle);
  }, [after, clearTimers]);

  // Respect the user's motion preference.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Only animate while the section is on screen.
  useEffect(() => {
    if (reduced) {
      showFinalState();
      return undefined;
    }
    const node = sectionRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) runCycle();
        else clearTimers();
      },
      { threshold: 0.25 }
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      clearTimers();
    };
  }, [reduced, runCycle, clearTimers, showFinalState]);

  return (
    <section
      id="demo"
      ref={sectionRef}
      aria-labelledby="demo-heading"
      className="border-y border-indigo-500/10"
      style={{ background: 'rgba(99,102,241,0.025)' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-12">
          <Eyebrow className="mb-4">Simulated demo</Eyebrow>
          <h2 id="demo-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">
            Watch the agents <span className="gradient-text">work a lead</span>
          </h2>
          <p className="max-w-2xl mx-auto text-slate-300">
            One enquiry, start to finish. This is a scripted example — not live customer data.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Inbound message ── */}
          <div className="glass-card rounded-2xl p-6 min-h-[150px]">
            <Label>Inbound · WhatsApp</Label>
            <div
              className={`mt-4 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-slate-200 leading-relaxed transition-opacity duration-500 ${
                step >= 1 ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ background: 'rgba(30,41,59,0.9)' }}
            >
              {INBOUND_MESSAGE}
            </div>
          </div>

          {/* ── Qualifier ── */}
          <div className="glass-card rounded-2xl p-6 min-h-[150px]">
            <Label>
              Qualifier agent
              <Dot active={step === 2} />
            </Label>
            <dl className="mt-4 space-y-2 font-mono text-xs">
              {QUALIFIER_FIELDS.map((field, i) => (
                <div
                  key={field.key}
                  className={`flex items-start gap-3 transition-all duration-300 ${
                    i < fieldCount ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
                  }`}
                >
                  <dt className="text-slate-500 w-36 flex-shrink-0">{field.key}</dt>
                  <dd className={valueClass(field.tone)}>{field.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* ── Closer ── */}
          <div className="glass-card rounded-2xl p-6 min-h-[170px]">
            <Label>
              Closer agent
              <Dot active={step === 3} />
            </Label>
            <div className="mt-4">
              <div className="font-mono text-xs text-slate-500 mb-2">reply_message</div>
              {/* aria-live off + full text in the DOM: assistive tech reads
                  the finished sentence once, not one character at a time. */}
              <p
                aria-live="off"
                className="rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-slate-100 leading-relaxed min-h-[124px] md:min-h-[76px]"
                style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)' }}
              >
                <span aria-hidden="true">{typed}</span>
                <span className="sr-only">{CLOSER_REPLY}</span>
                {step === 3 && typed.length < CLOSER_REPLY.length && (
                  <span aria-hidden="true" className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-indigo-400 animate-pulse" />
                )}
              </p>
              <div className="mt-3 font-mono text-xs flex items-center gap-3">
                <span className="text-slate-500">closing_type</span>
                <span className={valueClass('accent')}>urgent</span>
              </div>
            </div>
          </div>

          {/* ── CRM ── */}
          <div className="glass-card rounded-2xl p-6 min-h-[170px]">
            <Label>
              CRM
              <Dot active={step === 4} />
            </Label>

            <div className="mt-5 flex items-center gap-2">
              {STAGES.map((stage, i) => (
                <React.Fragment key={stage}>
                  {i > 0 && <span aria-hidden="true" className="text-slate-600 text-xs">→</span>}
                  <span
                    className={`px-3 py-1.5 rounded-full text-[11px] font-mono font-semibold transition-colors duration-300 ${
                      i <= stageIdx
                        ? 'text-indigo-200 border border-indigo-400/40 bg-indigo-500/15'
                        : 'text-slate-500 border border-slate-700/60'
                    }`}
                  >
                    {stage}
                  </span>
                </React.Fragment>
              ))}
            </div>

            <div className="mt-6 flex items-baseline gap-3">
              <span className="text-3xl font-bold font-mono gradient-text">{score}</span>
              <span className="text-sm text-slate-400">/ 100 lead score</span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            type="button"
            onClick={reduced ? showFinalState : runCycle}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-200 border border-indigo-500/25 bg-slate-900/60 hover:border-indigo-400/50 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            ↻ Replay
          </button>
          <p className="text-xs text-slate-400 font-mono">
            Simulated demo · not live customer data
          </p>
        </div>
      </div>
    </section>
  );
}

function Label({ children }) {
  return (
    <Eyebrow as="div" className="flex items-center gap-2">
      {children}
    </Eyebrow>
  );
}

function Dot({ active }) {
  if (!active) return null;
  return (
    <span aria-hidden="true" className="relative flex w-2 h-2 ml-1">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-500" />
    </span>
  );
}

function valueClass(tone) {
  if (tone === 'hot')    return 'text-red-400 font-semibold';
  if (tone === 'accent') return 'text-indigo-300 font-semibold';
  return 'text-slate-200';
}
```

- [ ] **Step 2: Add it to the page**

In `vite-app/src/pages/Landing.jsx`:

```jsx
import AgentPipeline from '@components/landing/AgentPipeline';
```

```jsx
      <main>
        <Hero />
        <StatsBar />
        <HowItWorks />
        <Features />
        <AgentPipeline />
      </main>
```

- [ ] **Step 3: Verify the animation behaves**

```bash
npm test && npm run build
```

Expected: 30 tests PASS, build succeeds.

Then with `npm run dev`, check each of these in the browser:

1. Scroll to the demo section — the cycle runs: message → Qualifier fields → typed reply → stage badges + score counting to 91.
2. It loops after a short hold.
3. Scroll far away and back — it restarts cleanly, with no doubled-speed typing (that symptom means timers stacked and `clearTimers` is not firing).
4. Click **Replay** mid-cycle — it restarts from the beginning.
5. The section does not change height at any point during the cycle.
6. Enable **System Settings → Accessibility → Display → Reduce motion**, reload: the section shows the completed state immediately and never animates.

- [ ] **Step 4: Confirm no vendor names leaked in**

```bash
grep -rniE "claude|anthropic|openai|gpt-" vite-app/src/components/landing/ vite-app/src/pages/Landing.jsx
```

Expected: matches only inside comments that cite `claude.service.js` file paths. No match in any rendered string.

- [ ] **Step 5: Commit**

```bash
git add vite-app/src/components/landing/AgentPipeline.jsx vite-app/src/pages/Landing.jsx
git commit -m "feat(landing): add animated agent pipeline demo

Scripted replay of one qualification using the real Qualifier/Closer
JSON field names. Pauses off-screen, honours prefers-reduced-motion,
and is labelled a simulated demo throughout."
```

---

## Task 5: Pricing

Four tiers with a monthly/yearly toggle. **Numbers must match `vite-app/src/pages/Billing.jsx` (`PLANS`, line 9)** — that is the in-app source of truth, and a landing page advertising prices the billing screen contradicts is a refund request waiting to happen.

Yearly mode shows the **per-month equivalent** with a `billed annually` note, not the annual total.

**Files:**
- Create: `vite-app/src/components/landing/Pricing.jsx`
- Modify: `vite-app/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: `SIGNUP_HREF` from `@components/landing/links`.
- Produces: `Pricing` — default export, no props. Renders a section with `id="pricing"`.

- [ ] **Step 1: Create the pricing section**

Create `vite-app/src/components/landing/Pricing.jsx`:

```jsx
// src/components/landing/Pricing.jsx — four-tier pricing with a billing toggle.
//
// Prices mirror src/pages/Billing.jsx (PLANS, line 9), which is the
// in-app source of truth. If you change a number here, change it there
// too — a landing page that contradicts the billing screen loses trust
// at exactly the wrong moment.
import React, { useState } from 'react';
import CtaButton from './CtaButton';
import Eyebrow from './Eyebrow';
import { SIGNUP_HREF } from './links';

const PLANS = [
  {
    name: 'Starter',
    monthly: 29,
    yearlyPerMonth: 23,
    yearlyTotal: 276,
    blurb: 'For solo founders starting with WhatsApp sales automation.',
    features: ['500 contacts', '2,000 AI messages/mo', '1 WhatsApp number', 'Basic analytics', 'Email support'],
    featured: false,
  },
  {
    name: 'Growth',
    monthly: 79,
    yearlyPerMonth: 63,
    yearlyTotal: 756,
    blurb: 'For small teams running active Meta Ad campaigns.',
    features: ['2,500 contacts', '10,000 AI messages/mo', '2 WhatsApp numbers', 'Full analytics', 'Chat support'],
    featured: false,
  },
  {
    name: 'Pro',
    monthly: 149,
    yearlyPerMonth: 119,
    yearlyTotal: 1428,
    blurb: 'For sales teams scaling WhatsApp and Meta into a revenue engine.',
    features: ['10,000 contacts', '50,000 AI messages/mo', '5 WhatsApp numbers', 'Meta CAPI attribution', 'Priority support'],
    featured: true,
  },
  {
    name: 'Agency',
    monthly: 349,
    yearlyPerMonth: 279,
    yearlyTotal: 3348,
    blurb: 'For agencies reselling AI sales automation under their own brand.',
    features: ['Unlimited contacts', '250,000 AI messages/mo', '25 WhatsApp numbers', 'White-label workspaces', 'Dedicated support'],
    featured: false,
  },
];

export default function Pricing() {
  const [cycle, setCycle] = useState('monthly');
  const yearly = cycle === 'yearly';

  return (
    <section id="pricing" aria-labelledby="pricing-heading">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-10">
          <Eyebrow className="mb-4">Pricing</Eyebrow>
          <h2 id="pricing-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">
            Plans that pay for <span className="gradient-text">themselves</span>
          </h2>
          <p className="text-slate-300">
            Every plan starts with a 14-day free trial. No credit card required.
          </p>
        </div>

        {/* Billing cycle toggle */}
        <div
          className="flex justify-center mb-12"
          role="group"
          aria-label="Billing cycle"
        >
          <div className="inline-flex p-1 rounded-xl border border-indigo-500/15" style={{ background: 'rgba(15,23,42,0.6)' }}>
            {[
              ['monthly', 'Monthly'],
              ['yearly', 'Yearly'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={cycle === value}
                onClick={() => setCycle(value)}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  cycle === value ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                style={cycle === value ? { background: 'linear-gradient(135deg,rgba(99,102,241,0.25),rgba(139,92,246,0.2))' } : undefined}
              >
                {label}
                {value === 'yearly' && (
                  <span className="ml-2 text-[10px] font-mono text-emerald-400">save 20%</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              className={`glass-card rounded-2xl p-6 flex flex-col ${
                plan.featured ? 'border-indigo-400/40 lg:-mt-3 lg:pb-9' : ''
              }`}
              style={plan.featured ? { borderColor: 'rgba(129,140,248,0.4)' } : undefined}
            >
              {plan.featured && (
                <span className="self-start mb-3 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-200 bg-indigo-500/20 border border-indigo-400/30">
                  Most popular
                </span>
              )}

              <h3 className="text-lg font-semibold text-slate-100">{plan.name}</h3>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold font-mono text-white">
                  ${yearly ? plan.yearlyPerMonth : plan.monthly}
                </span>
                <span className="text-sm text-slate-400">/month</span>
              </div>
              <p className="mt-1 text-xs text-slate-400 font-mono h-4">
                {yearly ? `billed annually — $${plan.yearlyTotal.toLocaleString()}/yr` : ''}
              </p>

              <p className="mt-4 text-sm text-slate-400 leading-relaxed">{plan.blurb}</p>

              <ul className="mt-5 space-y-2.5 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-slate-300">
                    <span aria-hidden="true" className="text-indigo-400 mt-0.5">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>

              <CtaButton
                href={SIGNUP_HREF}
                variant={plan.featured ? 'primary' : 'secondary'}
                className="mt-7 block w-full"
              >
                Start free trial
              </CtaButton>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-slate-400">
          All plans include the full dual-agent engine. Upgrade, downgrade or cancel at any time.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add it to the page**

In `vite-app/src/pages/Landing.jsx`:

```jsx
import Pricing from '@components/landing/Pricing';
```

```jsx
        <AgentPipeline />
        <Pricing />
```

- [ ] **Step 3: Verify prices match the billing screen**

```bash
grep -nE "monthly:|yearly:" vite-app/src/pages/Billing.jsx
grep -nE "monthly:|yearlyTotal:" vite-app/src/components/landing/Pricing.jsx
```

Expected: `Billing.jsx` monthly values 29 / 79 / 149 / 349 match `Pricing.jsx` `monthly`; `Billing.jsx` yearly values 276 / 756 / 1428 / 3348 match `Pricing.jsx` `yearlyTotal`.

- [ ] **Step 4: Verify in the browser**

```bash
npm test && npm run build
```

Expected: 30 tests PASS, build succeeds.

With `npm run dev`: toggle between Monthly and Yearly and confirm all four cards switch together, the "billed annually" line appears only in yearly mode, and the card heights do not jump (the note occupies a fixed `h-4` either way). Confirm every "Start free trial" button lands on `/auth` with the Get Started tab active.

- [ ] **Step 5: Commit**

```bash
git add vite-app/src/components/landing/Pricing.jsx vite-app/src/pages/Landing.jsx
git commit -m "feat(landing): add pricing section matching Billing.jsx tiers"
```

---

## Task 6: FAQ, final CTA and footer

**Files:**
- Create: `vite-app/src/components/landing/Faq.jsx`
- Create: `vite-app/src/components/landing/FinalCta.jsx`
- Create: `vite-app/src/components/landing/LandingFooter.jsx`
- Modify: `vite-app/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: `SIGNUP_HREF`, `BRAND_NAME`, `SALES_EMAIL`, `NAV_LINKS` from `@components/landing/links`.
- Produces: `Faq` (section `id="faq"`), `FinalCta`, `LandingFooter` — default exports, no props.

- [ ] **Step 1: Create the FAQ**

Create `vite-app/src/components/landing/Faq.jsx`. Uses native `<details>`/`<summary>` — no JavaScript, keyboard-operable by default.

Answers are deliberately conservative placeholders. They are written to be edited: do not add specific compliance certifications, uptime guarantees, or security claims that have not been verified.

```jsx
// src/components/landing/Faq.jsx — objection handling.
//
// Native <details>/<summary>: zero JS, keyboard-accessible by default.
//
// These answers are EDITABLE PLACEHOLDERS. Do not add specific
// certifications (SOC 2, ISO, HIPAA) or contractual guarantees unless
// they have been verified — an unverified compliance claim on a page
// aimed at paid traffic is a liability, not a conversion lever.
import React from 'react';
import Eyebrow from './Eyebrow';

const FAQS = [
  {
    q: 'Is my data secure?',
    a: 'Every record is scoped to your own workspace, and your WhatsApp and Meta credentials are encrypted at rest with AES-256-GCM. Traffic is served over TLS. If you need a security review before signing up, contact sales and we will walk you through exactly how the setup works.',
  },
  {
    q: 'How long does setup take?',
    a: 'Most teams are live the same day. You connect your WhatsApp Business number, paste in the facts your AI is allowed to use, and send a test message. Meta Ads attribution takes a little longer if you have not set up the Conversions API before.',
  },
  {
    q: 'What happens after the 14-day trial?',
    a: 'You pick a plan and carry on, or you do nothing and the workspace pauses. No card is required to start, so nothing is charged automatically when the trial ends.',
  },
  {
    q: 'Does this replace my sales team?',
    a: 'No — it replaces the follow-up your team never gets to. The AI handles qualification and first response around the clock, then hands over to a human when a lead is ready to buy or asks something outside its brief. Your closers spend their time on leads that are already warm.',
  },
  {
    q: 'Do I need my own WhatsApp Business account?',
    a: 'Yes. You connect your own WhatsApp Business number so conversations happen under your brand and you keep ownership of the number and the message history.',
  },
  {
    q: 'Can the AI make things up about my product?',
    a: 'It is constrained not to. The Closer agent may only use facts you have supplied in your configuration, and replies that stray outside that — inventing discounts, guarantees or services you do not offer — are blocked before they are sent.',
  },
];

export default function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="border-y border-indigo-500/10">
      <div className="max-w-3xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-12">
          <Eyebrow className="mb-4">Questions</Eyebrow>
          <h2 id="faq-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            Before you <span className="gradient-text">sign up</span>
          </h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group glass-card rounded-2xl px-6 py-5 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-base font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-lg">
                {item.q}
                <span
                  aria-hidden="true"
                  className="flex-shrink-0 text-indigo-400 text-xl leading-none transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-4 text-sm text-slate-400 leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create the final CTA**

Create `vite-app/src/components/landing/FinalCta.jsx`:

```jsx
// src/components/landing/FinalCta.jsx — closing ask.
//
// Low-friction framing only: no countdown timers, no invented scarcity.
import React from 'react';
import CtaButton from './CtaButton';
import { SIGNUP_HREF } from './links';

export default function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[38rem] h-[38rem] rounded-full pointer-events-none opacity-20"
        style={{ background: 'radial-gradient(circle,#6366f1,transparent 70%)', filter: 'blur(90px)' }}
      />
      <div className="relative max-w-3xl mx-auto px-6 py-20 md:py-28 text-center">
        <h2 id="cta-heading" className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-5">
          Your next lead is <span className="gradient-text">already waiting</span>
        </h2>
        <p className="text-lg text-slate-300 mb-9 max-w-xl mx-auto leading-relaxed">
          Connect your WhatsApp number and let the agents work your enquiries tonight.
          Set-up takes minutes.
        </p>
        <CtaButton href={SIGNUP_HREF} size="lg">
          Start free trial →
        </CtaButton>
        <p className="mt-5 text-sm text-slate-400">
          14-day free trial · No credit card required · Cancel anytime
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create the footer**

Create `vite-app/src/components/landing/LandingFooter.jsx`:

```jsx
// src/components/landing/LandingFooter.jsx — footer nav and trust badges.
import React from 'react';
import LogoMark from './LogoMark';
import { LOGIN_HREF, NAV_LINKS, SALES_EMAIL, SIGNUP_HREF } from './links';

export default function LandingFooter() {
  return (
    <footer className="border-t border-indigo-500/10">
      <div className="max-w-6xl mx-auto px-6 py-14">
        <div className="flex flex-col md:flex-row md:items-start gap-10 md:gap-6">
          <div className="md:flex-1">
            <div className="mb-3">
              <LogoMark />
            </div>
            <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
              The AI Sales Operating System. Close deals while you sleep.
            </p>
          </div>

          <nav aria-label="Footer" className="md:flex-1">
            <FooterHeading>Product</FooterHeading>
            <ul className="space-y-2.5">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-slate-400 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="md:flex-1">
            <FooterHeading>Get started</FooterHeading>
            <ul className="space-y-2.5">
              <li>
                <a href={SIGNUP_HREF} className="text-sm text-slate-400 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
                  Start free trial
                </a>
              </li>
              <li>
                <a href={LOGIN_HREF} className="text-sm text-slate-400 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
                  Sign in
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${SALES_EMAIL}?subject=ASOS%20Demo%20Request`}
                  className="text-sm text-slate-400 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                >
                  Contact sales
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} dspagenthub.com · All rights reserved
          </p>
          <div className="flex items-center gap-6 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true">🔒</span> End-to-end encrypted
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true">⚡</span> 99.9% uptime
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// Footer column heading. Deliberately not <Eyebrow>: these are real <h2>
// landmarks in a lighter shade, not the indigo section label.
function FooterHeading({ children }) {
  return (
    <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-widest font-mono mb-4">
      {children}
    </h2>
  );
}
```

- [ ] **Step 4: Complete the page**

`vite-app/src/pages/Landing.jsx` in full:

```jsx
// src/pages/Landing.jsx — public marketing landing page.
//
// Composed of focused section components. Sections are ordered as a
// sales argument: promise -> proof -> mechanism -> demonstration ->
// price -> objections -> ask.
//
// overflow-x-clip, NOT overflow-x-hidden: `hidden` forces overflow-y to
// compute as `auto`, which makes this element the scroll container and
// silently breaks the sticky nav. `clip` leaves overflow-y visible while
// still containing the decorative orbs each section renders.
import React from 'react';
import LandingNav from '@components/landing/LandingNav';
import Hero from '@components/landing/Hero';
import StatsBar from '@components/landing/StatsBar';
import HowItWorks from '@components/landing/HowItWorks';
import Features from '@components/landing/Features';
import AgentPipeline from '@components/landing/AgentPipeline';
import Pricing from '@components/landing/Pricing';
import Faq from '@components/landing/Faq';
import FinalCta from '@components/landing/FinalCta';
import LandingFooter from '@components/landing/LandingFooter';

export default function Landing() {
  return (
    <div className="min-h-screen bg-bg text-slate-100 font-sans overflow-x-clip">
      <LandingNav />
      <main>
        <Hero />
        <StatsBar />
        <HowItWorks />
        <Features />
        <AgentPipeline />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
```

- [ ] **Step 5: Full-page verification**

```bash
npm test && npm run build
```

Expected: 30 tests PASS, build succeeds.

With `npm run dev`, run the full check:

1. Every nav and footer anchor scrolls to the right section.
2. FAQ items expand and collapse by mouse **and** by keyboard (Tab to a question, press Enter or Space).
3. Resize to 375px, 768px, 1280px — no horizontal scrollbar at any width.
4. Tab from the top of the page to the bottom: focus is always visible, and the order follows the visual order.

- [ ] **Step 6: Commit**

```bash
git add vite-app/src/components/landing vite-app/src/pages/Landing.jsx
git commit -m "feat(landing): add FAQ, final CTA and footer"
```

---

## Task 7: SEO, Open Graph and the social preview image

Tags are static markup in `index.html`, not runtime-injected: the app is client-rendered with no SSR, and Facebook, LinkedIn and WhatsApp link scrapers do not run JavaScript. A `react-helmet` approach would leave previews blank on exactly the channels this page is built for.

**Files:**
- Create: `vite-app/scripts/make-og-cover.py`
- Create: `vite-app/public/og-cover.png`
- Modify: `vite-app/index.html`

**Interfaces:**
- Produces: `vite-app/public/og-cover.png`, served at `https://dspagenthub.com/og-cover.png`.

- [ ] **Step 1: Write the OG image generator**

`vite-app/public/` currently holds no image assets, so the OG tag would otherwise point at a 404 and previews would render blank. A script keeps the asset reproducible rather than a mystery binary.

Create `vite-app/scripts/make-og-cover.py`:

```python
#!/usr/bin/env python3
"""Generate the 1200x630 Open Graph cover for the landing page.

Run from vite-app/:  python3 scripts/make-og-cover.py
Requires Pillow:     python3 -m pip install --user Pillow
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
BG = (3, 7, 18)
INDIGO = (129, 140, 248)
VIOLET = (167, 139, 250)
SLATE = (148, 163, 184)
WHITE = (255, 255, 255)

FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def load_font(size, index=0):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=index)
            except (OSError, ValueError):
                continue
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# Subtle grid, matching the .grid-bg utility in src/index.css.
for x in range(0, W, 48):
    draw.line([(x, 0), (x, H)], fill=(10, 16, 34), width=1)
for y in range(0, H, 48):
    draw.line([(0, y), (W, y)], fill=(10, 16, 34), width=1)

# Accent glow, top-left.
glow = Image.new("RGB", (W, H), BG)
gdraw = ImageDraw.Draw(glow)
gdraw.ellipse([-260, -320, 640, 420], fill=(28, 28, 82))
img = Image.blend(img, glow, 0.55)
draw = ImageDraw.Draw(img)

# Logo mark.
draw.rounded_rectangle([80, 74, 140, 134], radius=18, fill=(99, 102, 241))
mark_font = load_font(34, index=1)
draw.text((110, 104), "A", font=mark_font, fill=WHITE, anchor="mm")

brand_font = load_font(30, index=1)
draw.text((158, 104), "ASOS", font=brand_font, fill=WHITE, anchor="lm")

# Eyebrow.
eyebrow_font = load_font(20)
draw.text((80, 240), "THE FUTURE OF SALES", font=eyebrow_font, fill=INDIGO)

# Headline.
head_font = load_font(78, index=1)
draw.text((80, 286), "Close deals while", font=head_font, fill=WHITE)
draw.text((80, 378), "you sleep.", font=head_font, fill=VIOLET)

# Subheadline.
sub_font = load_font(27)
draw.text(
    (80, 492),
    "AI agents qualify every lead, diagnose their problem,",
    font=sub_font,
    fill=SLATE,
)
draw.text((80, 528), "and send the perfect WhatsApp message.", font=sub_font, fill=SLATE)

out = os.path.join(os.path.dirname(__file__), "..", "public", "og-cover.png")
img.save(os.path.normpath(out), "PNG", optimize=True)
print("wrote", os.path.normpath(out), img.size)
```

- [ ] **Step 2: Generate the image**

```bash
python3 scripts/make-og-cover.py
```

Expected output: `wrote .../vite-app/public/og-cover.png (1200, 630)`

If Pillow is missing, install it first:

```bash
python3 -m pip install --user Pillow
```

- [ ] **Step 3: Check the image visually**

```bash
open public/og-cover.png
```

Confirm: dark navy background, readable headline, no clipped text at the right edge, no vendor names.

- [ ] **Step 4: Update index.html**

Replace the `<head>` block of `vite-app/index.html` with the following, and change the `<html>` tag's `lang` attribute. The existing `lang="pt-BR"` is wrong for an English page and affects screen-reader pronunciation and search targeting.

```html
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>ASOS — Close deals while you sleep | AI Sales Operating System</title>
  <meta name="description" content="AI agents qualify every lead, diagnose their problem, and send the perfect WhatsApp message — automatically. 14-day free trial, no credit card required.">
  <link rel="canonical" href="https://dspagenthub.com/">

  <!-- Open Graph / social previews. Static markup on purpose: link
       scrapers do not execute JavaScript, so runtime-injected tags
       would leave previews blank. -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="ASOS">
  <meta property="og:url" content="https://dspagenthub.com/">
  <meta property="og:title" content="ASOS — Close deals while you sleep">
  <meta property="og:description" content="AI agents qualify every lead, diagnose their problem, and send the perfect WhatsApp message — automatically.">
  <meta property="og:image" content="https://dspagenthub.com/og-cover.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="ASOS — Close deals while you sleep. The AI Sales Operating System.">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="ASOS — Close deals while you sleep">
  <meta name="twitter:description" content="AI agents qualify every lead, diagnose their problem, and send the perfect WhatsApp message — automatically.">
  <meta name="twitter:image" content="https://dspagenthub.com/og-cover.png">

  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body class="bg-bg text-slate-100 font-sans">
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 5: Verify the asset ships in the build**

```bash
npm run build && ls -la dist/og-cover.png && grep -c "og:image" dist/index.html
```

Expected: `dist/og-cover.png` exists at roughly 40–90 KB, and `grep` reports `1`.

- [ ] **Step 6: Final full-page audit**

```bash
npm test
```

Expected: 30 tests PASS.

```bash
grep -rniE "claude|anthropic|openai|gpt-" vite-app/src/components/landing/ vite-app/src/pages/Landing.jsx vite-app/index.html
```

Expected: matches only in code comments citing `claude.service.js` paths — nothing in rendered copy or meta tags.

Then run the spec's §11 checklist end to end with `npm run dev`:

1. `/` logged out → landing renders, no login form above the fold
2. `/` with a session → redirects to `/dashboard`; SUPERADMIN → `/admin`
3. `/landing` → renders regardless of session
4. All 13 dashboard paths resolve and stay auth-gated
5. Every CTA lands on `/auth` with **Get Started** preselected
6. Anchors scroll correctly
7. Pricing toggle switches all four cards
8. Pipeline loops, Replay works, no stacked timers after scrolling away and back
9. Reduced motion → final state, no animation
10. No layout shift as the pipeline populates
11. 375 / 768 / 1280px — no horizontal scroll
12. Full keyboard pass
13. No vendor names in rendered text
14. `npm run build` succeeds

- [ ] **Step 7: Commit**

```bash
git add vite-app/index.html vite-app/public/og-cover.png vite-app/scripts/make-og-cover.py
git commit -m "feat(landing): add SEO and Open Graph tags with social cover

Static meta tags so link scrapers (which do not run JS) get real
previews. Also corrects lang=pt-BR to lang=en."
```

---

## Follow-ups (not in this plan)

Worth doing before the paid campaign runs, tracked separately:

1. **`Auth.jsx:368` claims Claude qualifies leads** — same false vendor claim this plan removed from the landing page. One-line copy fix.
2. **`getaisales-Landing.html`** — the legacy marketing page carries the same claim and links to the retired `https://app.getaisales.com/auth`. Either repoint it at `dspagenthub.com` or retire it.
3. **`CLAUDE.md`** documents the agents as `claude-haiku-4-5` / `claude-3-5-sonnet` and describes a `next_action === "handoff_human"` branch that `claude.service.js:74` explicitly says does not exist.
4. **`vite-app/.env.example`** — `VITE_APP_URL` still points at `asos-kappa.vercel.app`, and `VITE_MARKETING_URL` at `digitalservicesprogram.com`, which drives the "← Back to site" link on `/auth`. That link should now point at `/`.
5. **No ESLint flat config** — ESLint 9 is installed but `vite-app/` has no `eslint.config.js`, so `npm run lint` cannot run.
