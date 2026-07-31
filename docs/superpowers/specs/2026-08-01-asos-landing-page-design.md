# ASOS Landing Page — Design

**Date:** 2026-08-01
**Status:** Approved for implementation
**Scope:** A standalone, conversion-focused marketing landing page inside `vite-app`, decoupled from the auth form, served at the root of `https://dspagenthub.com`.

---

## 1. Problem

Paid traffic and prospects currently land on `/auth`, where landing copy (tagline, feature list, stats, the Claude AI card) shares the viewport with a login/register form. The form competes with the pitch for attention above the fold, and the page cannot be structured as a sales page because its job is authentication.

The separate static marketing site (`getaisales-Landing.html`) is stale: it hardcodes `https://app.getaisales.com/auth`, a domain the product has since moved off.

We need one page whose only job is to sell, that links into the existing signup flow rather than duplicating it.

## 2. Deployment context

Everything now runs on Railway under a single domain, `https://dspagenthub.com`.

- `railway.json` builds `vite-app/Dockerfile` and starts `npm run preview`.
- `vite.config.js` already allows `dspagenthub.com` and `www.dspagenthub.com` in `preview.allowedHosts`.
- The SPA therefore serves the domain root. The landing page at `/` **is** `https://dspagenthub.com/`.

**Consequence:** all CTAs use **relative** hrefs (`/auth?tab=register`). No domain is hardcoded in component code, so the page behaves identically on `dspagenthub.com`, `www.dspagenthub.com`, and Railway preview URLs. Absolute `https://dspagenthub.com` URLs appear only in the SEO tags that require them (canonical, `og:url`, `og:image`).

The legacy `getaisales-*.html` files and `frontend/` are out of scope for this change and are left untouched.

## 3. Routing

Changes are confined to `vite-app/src/main.jsx`.

| Path | Behavior |
|---|---|
| `/` | `<PublicHome>` — renders `Landing` when logged out; `<Navigate>` to `/dashboard` (or `/admin` for `SUPERADMIN`) when a session exists |
| `/landing` | Always renders `Landing`, regardless of session — direct link for previews and ad destinations |
| `/auth`, `/reset-password` | Unchanged |
| `/dashboard`, `/leads`, … | Unchanged URLs (see below) |
| `*` | Auth-aware: logged in → existing `DefaultRedirect`; logged out → `<Navigate to="/">` |

### Preserving dashboard URLs

The dashboard shell is currently `<Route path="/" element={<PrivateRoute><DashboardLayout/></PrivateRoute>}>` with relative children (`dashboard`, `leads`, …) and an `index` route.

It converts to a **pathless layout route**:

```jsx
<Route element={<PrivateRoute><DashboardLayout /></PrivateRoute>}>
  <Route path="/dashboard" element={<TenantRoute><DashboardPage /></TenantRoute>} />
  <Route path="/leads"     element={<TenantRoute><PipelinePage /></TenantRoute>} />
  {/* … */}
</Route>
```

Children become absolute paths. **Every existing dashboard URL stays byte-identical** — only the wrapping route changes. The old `index` route (`DefaultRedirect`) is removed because `/` is now handled by `PublicHome`.

### Loading strategy

`Landing` is imported **eagerly**, not via `React.lazy`. It is the entry point for paid traffic; a lazy chunk costs an extra round trip before LCP. All other pages remain lazy.

`AuthInitializer` needs no change: `initAuth` short-circuits synchronously when no token is present (`auth.store.js:56`), so a cold visitor never waits on a `/auth/me` network call.

## 4. Component structure

New directory `vite-app/src/components/landing/`, one focused file per section.

| File | Responsibility |
|---|---|
| `src/pages/Landing.jsx` | Page shell — `<header>/<main>/<footer>` landmarks, composes sections in order |
| `src/components/landing/links.js` | `SIGNUP_HREF`, `LOGIN_HREF`, `SALES_EMAIL`, `BRAND_NAME` — single source for CTA targets |
| `src/components/landing/LandingNav.jsx` | Sticky nav: logo mark, in-page anchors, "Sign in" + "Start free trial" |
| `src/components/landing/Hero.jsx` | Eyebrow → h1 → subheadline → dual CTA → trial microcopy |
| `src/components/landing/StatsBar.jsx` | 78% / 11.1% / 5.68x |
| `src/components/landing/HowItWorks.jsx` | 4 steps |
| `src/components/landing/Features.jsx` | 3-column feature breakdown |
| `src/components/landing/AgentPipeline.jsx` | Animated replay of one qualification, end to end |
| `src/components/landing/Pricing.jsx` | 4 tiers + monthly/yearly toggle |
| `src/components/landing/Faq.jsx` | Objection-handling accordion |
| `src/components/landing/FinalCta.jsx` | Repeat trial offer |
| `src/components/landing/LandingFooter.jsx` | Nav, contact sales, security/uptime badges |

Each component owns its own copy and renders from a local array where the content repeats. Two components hold local state — `Pricing` (`cycle`) and `AgentPipeline` (animation step); everything else is presentational.

### `links.js` contract

```js
export const SIGNUP_HREF = '/auth?tab=register';
export const LOGIN_HREF  = '/auth';
export const BRAND_NAME  = import.meta.env.VITE_BRAND_NAME  || 'ASOS';
export const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL || 'info@digitalservicesprogram.com';
```

`?tab=register` is the parameter `Auth.jsx:37` actually reads. (The original request said `?mode=signup`, which the auth page ignores — it would silently land users on the Sign In tab.) The env fallbacks mirror `Auth.jsx:9-11` so branding stays consistent between the two pages.

CTAs are plain `<a href>` rather than react-router `<Link>`. `/auth` is a lazy-loaded route in the same SPA; a full document navigation is acceptable here and keeps the CTA a real link for crawlers, middle-click, and "open in new tab".

## 5. Page content

### Hero
- Eyebrow: `THE FUTURE OF SALES` (mono, uppercase, tracked)
- H1: "Close deals while **you sleep.**" — second line in `.gradient-text`
- Sub: "AI agents qualify every lead, diagnose their problem, and send the perfect WhatsApp message — automatically." (vendor-neutral; see below)
- Primary CTA: "Start free trial →" → `SIGNUP_HREF`
- Secondary CTA: "Watch the agents work" → `#demo` anchor (in-page, no new form)
- Microcopy: "14-day free trial · No credit card required · Cancel anytime"

### Stats bar
`78%` AI handling rate · `11.1%` conversion rate · `5.68x` average ROAS. Values in `font-mono` + `.gradient-text`, labels in `slate-400`.

### How it works — 4 steps
1. **Lead comes in** — from a Meta ad, a WhatsApp message, or an organic signup.
2. **AI qualifies & diagnoses** — the Qualifier agent scores intent and identifies the real problem.
3. **Personalized WhatsApp sent** — the Closer agent writes and sends the reply, grounded strictly in your configured facts.
4. **Deal closes, tracked in CRM** — stage advances, activity is logged, Meta CAPI fires server-side.

### Features — 3 columns
- **Dual-Agent AI Engine** ◎ — a Qualifier scores and diagnoses every lead, a Closer writes the reply
- **Multi-tenant CRM** ◈ — full pipeline, contacts and activity tracking
- **Meta Ads Attribution** ⬗ — server-side CAPI for pixel-perfect ROI

### Agent pipeline — animated (`id="demo"`)

The conversion centerpiece. Replays one full qualification on a loop, so a visitor watches the product work instead of reading about it. The dual-agent architecture is the actual differentiator, so the animation is built to *explain* it, not just to move.

**Scripted timeline** (~12s, then loops after a 2s hold):

| Step | Duration | What appears |
|---|---|---|
| 1 | 0–2s | Inbound WhatsApp bubble slides in from the left — a lead's message |
| 2 | 2–6s | **Qualifier agent** card: fields populate one at a time, each with a brief shimmer |
| 3 | 6–10s | **Closer agent** card: `reply_message` types out character by character |
| 4 | 10–12s | CRM row: stage advances `NEW → QUALIFYING → DIAGNOSED`, lead score counts up to 91/100 |

**Field names and value sets are taken verbatim from `claude.service.js`**, so the animation doubles as accurate product documentation:

- Qualifier (`QUALIFIER_SCHEMA`, `claude.service.js:50-58`) — `lead_status: HOT`, `score: 9/10`, `intent: high`, `problem_summary`, `next_action: send_proposal`
- Closer (`CLOSER_SCHEMA`, `claude.service.js:228-234`) — `reply_message`, `closing_type: urgent`

The `reply_message` reuses the established line: *"Based on your answers, I can see this is costing you ~$40k/month in lost leads. Let me show you how we fix this…"* — carried over from `Auth.jsx:415` for continuity between the two pages.

**Two score scales, deliberately.** The Qualifier returns `score` on a 1–10 scale (`claude.service.js:55`), while `Lead.aiScore` is stored out of 100 (`claude.service.js:153`). The animation shows `9/10` on the Qualifier card and `91/100` on the CRM row. These are different fields, not an inconsistency; the section labels them distinctly so the page doesn't imply one number contradicts the other.

**Honesty constraints — non-negotiable:**
- A persistent `SIMULATED DEMO` badge sits on the section, in the mono eyebrow style.
- No wording anywhere implies real-time production traffic, live customer data, or current activity. No "right now", no relative timestamps, no fabricated customer names or counters.
- The example lead is generic and unattributed.

**Implementation:**
- A single `useEffect` state machine driving a step index with `setTimeout`; cleared on unmount. No animation library, no new dependency.
- An `IntersectionObserver` pauses the loop when the section is off-screen, so it costs nothing while a visitor reads the rest of the page.
- A visible **Replay** button lets a user restart it deliberately.
- `prefers-reduced-motion: reduce` → the animation does not run at all. The section renders its **final state** immediately, statically, with all content present. Nothing is hidden behind motion, so the section is fully legible either way.

### AI vendor claim

The page describes the engine in **vendor-neutral** terms: "dual-agent AI engine", "AI qualifies every lead". It does not name Claude, Anthropic, GPT, or OpenAI.

This is a correctness requirement, not a style preference. The pipeline in `claude.service.js` — despite its filename — instantiates the OpenAI SDK (`claude.service.js:11,17`) with `OPENAI_MODEL` defaulting to `gpt-5.4-mini` (`env.js:33`). `ANTHROPIC_API_KEY` is optional in the env schema, and the Anthropic SDK is imported only by `content-studio.service.js` for ad-copy generation — not by the sales agents. A landing page claiming "Claude AI qualifies every lead" would therefore misstate the product to paid traffic.

Vendor-neutral copy is also durable: it stays true if the models are swapped again.

**Note:** the inaccurate claim already exists in `Auth.jsx:368` and in `getaisales-Landing.html`. Correcting those is out of scope here but should be picked up — see §10.

### Pricing
Four tiers with a monthly/yearly toggle. Numbers are taken from `vite-app/src/pages/Billing.jsx` (`PLANS`), which is the in-app source of truth, rather than from the stale static HTML:

| Tier | Monthly | Yearly (per mo.) | Positioning |
|---|---|---|---|
| Starter | $29 | $23 | Solo founders starting with WhatsApp sales automation |
| Growth | $79 | $63 | Small teams running active Meta Ad campaigns |
| Pro | $149 | $119 | Sales teams scaling WhatsApp + Meta into a revenue engine |
| Agency | $349 | $279 | Agencies reselling AI sales automation under their own brand |

Toggling to yearly displays the **per-month equivalent** (e.g. `$23 /month`) with a `billed annually` note beneath, rather than the annual total. This matches how the tiers were presented on the previous landing page and avoids the sticker-shock of a `$276` headline. The annual totals from `Billing.jsx` (276 / 756 / 1428 / 3348) are what the user is actually charged and appear in the note.

Pro is the highlighted tier. Every card's CTA points at `SIGNUP_HREF` — pricing selection happens after signup, in the existing Billing page. The landing page does not build a checkout.

Keeping these figures aligned with `Billing.jsx` is a maintenance requirement; the file carries a comment saying so.

### FAQ
Placeholder Q&As, written to be edited. Implemented with native `<details>` / `<summary>` elements — zero JavaScript and keyboard-accessible by default.

1. Is my data secure?
2. How long does setup take?
3. What happens after the 14-day trial?
4. Does this replace my sales team?
5. Do I need my own WhatsApp Business account?
6. Which languages does the AI handle?

### Final CTA
Headline repeating the offer, primary "Start free trial →", and the no-credit-card / cancel-anytime framing. Low-friction, no urgency countdown or fabricated scarcity.

### Footer
Section anchors, "Contact sales" (`mailto:` using `SALES_EMAIL`), and the trust badges from `Auth.jsx:686-689`: 🔒 End-to-end encrypted · ⚡ 99.9% uptime. Copyright line reads `dspagenthub.com`.

## 6. Brand tokens

Extracted from the existing app, not invented. Sources: `tailwind.config.js`, `src/index.css`, `src/pages/Auth.jsx`.

- **Colors:** `bg` `#030712`, `surface` `#0f172a`, `surface2` `#1e293b`, `accent` `#6366f1`, `accent2` `#8b5cf6` — all available as Tailwind classes (`bg-bg`, `text-accent`, …)
- **Fonts:** Space Grotesk (`font-sans`), JetBrains Mono (`font-mono`) — already preloaded in `index.html`
- **Utilities:** `.glass`, `.glass-card`, `.gradient-text`, `.grid-bg`, `.glow-accent`, `animate-fade-in`
- **Primary button:** `linear-gradient(135deg,#6366f1,#8b5cf6)` with `box-shadow: 0 4px 24px rgba(99,102,241,0.3)` — copied from `Auth.jsx:522`
- **Eyebrow label:** `text-xs font-semibold text-indigo-400 uppercase tracking-widest` — from `Auth.jsx:362`
- **Radii:** `rounded-xl` (12px) for controls, `rounded-2xl` (16px) for cards, `rounded-3xl` (24px) for large panels
- **Section rhythm:** `py-20 md:py-28`, container `max-w-6xl mx-auto px-6`

No new colors, fonts, or spacing values are introduced. `tailwind.config.js` is not modified.

## 7. SEO

Tags are written as **static markup in `vite-app/index.html`**, not injected at runtime.

Rationale: the app is a client-rendered Vite SPA with no SSR. Facebook, LinkedIn and WhatsApp link scrapers do not execute JavaScript, so a `react-helmet`-style approach would leave paid-social previews blank — the exact channel this page is built for. Static tags apply app-wide, which is harmless because every other route is authentication-gated.

```html
<title>ASOS — Close deals while you sleep | AI Sales Operating System</title>
<meta name="description" content="AI agents qualify every lead, diagnose their problem, and send the perfect WhatsApp message — automatically. 14-day free trial, no credit card required.">
<link rel="canonical" href="https://dspagenthub.com/">
<meta property="og:type"        content="website">
<meta property="og:url"         content="https://dspagenthub.com/">
<meta property="og:title"       content="ASOS — Close deals while you sleep">
<meta property="og:description" content="AI agents qualify every lead, diagnose their problem, and send the perfect WhatsApp message — automatically.">
<meta property="og:image"       content="https://dspagenthub.com/og-cover.png">
<meta name="twitter:card"       content="summary_large_image">
```

Two additional fixes in the same file:
- `<html lang="pt-BR">` → `lang="en"`. The current value is wrong and affects screen-reader pronunciation and search targeting.
- A brand-matched `og-cover.png` (1200×630, `#030712` background, purple accent, tagline) is added to `vite-app/public/`, which currently holds no image assets. Without it the OG tag points at a 404 and link previews render blank.

## 8. Accessibility

- Semantic landmarks: `<header>`, `<main>`, `<section>`, `<footer>`; exactly one `<h1>` (the hero headline); sections titled by `<h2>`
- `aria-label` on the nav; each section linked by `aria-labelledby` to its heading
- FAQ uses native `<details>` / `<summary>` elements — expand/collapse works without JS and is keyboard-operable by default
- Decorative glyph icons (`◎ ◈ ⬗`) carry `aria-hidden="true"`; meaning is always conveyed by adjacent text
- Visible `focus-visible` rings on every link and button
- **Contrast:** body copy is held at `slate-300`/`slate-400` minimum against `#030712`. `Auth.jsx` uses `slate-600`/`slate-700` for microcopy; those shades fail WCAG AA at small sizes and are deliberately **not** reused for any load-bearing text on this page.
- The `.grid-bg` overlay and background orbs are `pointer-events-none` and decorative only
- **Motion:** `prefers-reduced-motion: reduce` disables the `AgentPipeline` loop entirely and renders its final state statically. No information is conveyed by motion alone, and the section has no auto-advancing content a user cannot control (it also has an explicit Replay button)
- The `AgentPipeline` typing effect writes into a container marked `aria-live="off"` with the completed text also present in the DOM, so screen readers announce the finished message once rather than character by character

## 9. Responsiveness & performance

- Mobile-first: single column → `md:` two columns → `lg:` three (features) / four (pricing)
- Nav collapses to logo + "Start free trial" below `md`; anchor links hide rather than opening a JS drawer
- No images in the page body — the visual identity is CSS gradients, borders and type, so there is nothing to lazily load and no layout shift from image loading
- No new npm dependencies. `recharts`, `axios` and the auth store are not imported by any landing component, so the landing bundle stays small
- The `AgentPipeline` animation is `setTimeout`-driven and `IntersectionObserver`-gated, so it consumes nothing while off-screen and stops cleanly on unmount. Its container is a fixed height at each breakpoint so the loop causes **no layout shift** (CLS) as content populates
- Added JS is a set of presentational components plus two small state machines (pricing toggle, animation step)

## 10. Out of scope

- No new signup form. The page links into the existing `/auth` flow.
- No checkout or Stripe interaction from the landing page.
- `getaisales-Landing.html`, `getaisales-shell.js`, the other top-level `*.html` files, and `frontend/` are untouched. They still reference the retired `app.getaisales.com` domain; cleaning them up is separate work.
- `vite-app/.env.example` still lists a stale `VITE_APP_URL` (`asos-kappa.vercel.app`) and points `VITE_MARKETING_URL` at `digitalservicesprogram.com`, which drives the "← Back to site" link on `/auth`. Repointing that link at the new landing page is a small follow-up, tracked separately.
- No test suite is wired up in this repo (`CLAUDE.md`); verification is manual — see below.
- **The "Claude AI" claim elsewhere in the product is not corrected here.** `Auth.jsx:368` and `getaisales-Landing.html` both state that Claude qualifies leads, which the code contradicts (§5). This spec makes the *new* page accurate; bringing the auth page and legacy marketing site in line is a separate, small follow-up worth doing before the paid campaign runs.
- `CLAUDE.md` is also stale on this point — it documents the agents as `claude-haiku-4-5` / `claude-3-5-sonnet`, and describes a `next_action === "handoff_human"` branch that `claude.service.js:74` explicitly says does not exist. Not touched here.

## 11. Verification

Manual, run from `vite-app`:

```bash
npm run dev
```

1. `/` logged out → landing page renders, no login form above the fold
2. `/` with a session in `localStorage` → redirects to `/dashboard`; `SUPERADMIN` → `/admin`
3. `/landing` → renders regardless of session state
4. `/dashboard`, `/leads`, `/conversations`, `/ai-insights`, `/ads`, `/analytics`, `/settings`, `/billing`, `/onboarding`, `/students`, `/dsp-reports`, `/automations`, `/admin` → all still resolve, still auth-gated
5. Every CTA lands on `/auth` with the **Get Started** tab preselected
6. `#demo` and footer anchors scroll to the right sections
7. Pricing toggle switches all four cards between monthly and yearly
8. `AgentPipeline` runs its full cycle and loops; Replay restarts it; scrolling away and back does not leave it mid-state or stacked with duplicate timers
9. With `prefers-reduced-motion: reduce` set at the OS level, the pipeline renders its complete final state and never animates
10. No layout shift as the pipeline populates — the section height is stable from first paint
11. Responsive check at 375px, 768px, 1280px — no horizontal scroll
12. Keyboard-only pass: tab through nav → hero CTAs → pipeline Replay → FAQ (expand with Enter/Space) → footer
13. No text on the page names Claude, Anthropic, GPT or OpenAI
14. `npm run build` succeeds and `npm run lint` is clean
