# marketing/ — DSP Marketing System

Guidance for Claude Code sessions working inside this module. This is one business unit
(DSP = AI Agents Bootcamp) of what will eventually be a multi-business-unit marketing system
under ASOS. Don't build generic/multi-BU abstractions until a second business unit exists —
`knowledge/dsp/` is scoped per-BU specifically so that's a mechanical addition later
(`knowledge/<other-bu>/`), not a refactor.

## What this is

An 8-agent content pipeline that generates demand for DSP and hands qualified leads to the
existing ASOS leads API (`backend/src/modules/leads`). It does not run its own database or
service — it's a set of scripts that call the Anthropic API and the existing backend.

## Layout

- `knowledge/dsp/` — voice, offers, and winners knowledge the agents read. Source of truth;
  agents must not contradict it or invent facts (prices, dates, testimonials) not present here.
- `agents/01-*.md` … `08-*.md` — one job description per agent, in pipeline order. Each file
  is written to double as a standalone system prompt you can paste into Anthropic Console —
  don't add repo-specific instructions inside them (no file paths, no "see pipeline/run.js").
- `pipeline/` — the orchestrator that runs agents against the Anthropic API.
  - `config.js` — model name, paths, DSP constants.
  - `schema.js` — JSDoc typedefs for ContentBrief / ContentAsset / LeadHandoff (this repo has
    no TypeScript tooling; see decision note below).
  - `run.js` — sequential content pipeline: scout → planner → hook-writer → content-writer →
    repurposer.
  - `dm-manager.js` — standalone: scores one inbound DM/comment, and if hot/warm, creates the
    lead via `leadsClient.js`.
  - `analyst.js` — standalone: turns a metrics CSV into a weekly report + appends winners.
  - `leadsClient.js` — the only file that talks to the real backend. Logs in via
    `POST /auth/login`, finds-or-creates a Contact, then `POST /leads` with
    `businessUnit: "DSP"`.
  - `agentRunner.js` — the pure "call one agent, return its JSON" logic (knowledge loading,
    prompt loading, the Claude call, JSON extraction). No filesystem writes. Shared by
    `run.js` (CLI, persists to disk) and `api/run.js` (Vercel, returns the result in the
    response instead — see below).
- `api/run.js` — Vercel serverless entrypoint. See "Deploying to Vercel" below.
- `output/` — gitignored. Every *local* pipeline run writes JSON + a human-readable `.md` per
  step to `output/dsp/<YYYY-MM-DD>/`. Not used when running via Vercel (see below).

## Why plain JS, not TypeScript

The rest of this repo (backend/, vite-app/) has no `tsconfig.json` and no `typescript`
dependency anywhere — backend is CommonJS, vite-app is JS/JSX. This module matches that:
plain `.js`, CommonJS (`require`/`module.exports`), so no new toolchain is introduced for one
module. If TypeScript is ever adopted repo-wide, this is the module to convert first since
`schema.js` is already typedef-shaped.

## How `businessUnit` works on Lead

The backend's Lead model has `businessUnit LeadBusinessUnit @default(UNKNOWN)` — an enum
(`DSP | SDC | UNKNOWN`) added by migration `20260602000000_add_lead_business_unit`. In the
normal WhatsApp flow the Qualifier AI classifies it per message; leads created via this
module's DM handoff declare `businessUnit: "DSP"` explicitly at `POST /leads` so they're
tagged correctly even without a WhatsApp conversation. Adding a business unit beyond
DSP/SDC requires extending that enum (a migration) plus the `VALID_BUSINESS_UNITS`
whitelist in `backend/src/modules/leads/leads.service.js`.

**Decided: DSP does not get its own WhatsApp number.** The webhook resolves tenant strictly
by `waPhoneId` (one number → one tenant, `backend/src/webhooks/whatsapp.webhook.js`), and a
dedicated DSP number would fight the classification scheme above, which was built precisely
so DSP and SDC can share one number with the AI sorting conversations by business unit. If a
second number is ever genuinely needed, it requires either a second Tenant (isolated
dashboard/login, DSP leads won't appear alongside sales leads) or real multi-number-per-tenant
support (schema change + webhook rewrite) — don't build either without re-confirming, since
the whole point of `businessUnit` was to avoid this.

## Auth model for scripts

`POST /leads` and `POST /contacts` require a JWT tied to a real tenant/user — there is no
service-account or API-key path in this backend. `leadsClient.js` logs in with
`MARKETING_API_EMAIL` / `MARKETING_API_PASSWORD` against `MARKETING_API_BASE_URL` and caches
the token for the process lifetime. Whichever tenant that user belongs to is the tenant DSP
leads land in — that's an environment/ops decision (which tenant represents DSP), not
something this module decides.

## Running

```
npm run marketing -- --step=all          # full pipeline
npm run marketing -- --step=scout        # single step
npm run marketing:dm -- --message="..."  # score + route one inbound DM
npm run marketing:analyst -- --metrics=path/to/metrics.csv
```

`ANTHROPIC_API_KEY` must be set in the environment (see `.env.example`). Never write a key to
any file in this repo.

## Deploying to Vercel

The CLI (`run.js`) writes output to local disk — that doesn't work on Vercel, whose
serverless functions have no durable/shared filesystem and time out. `api/run.js` is a
separate entrypoint built for that environment: it runs **one step per HTTP call** and
returns the JSON directly in the response instead of writing a file. The caller chains steps
by passing the previous response's `output` back in as `previousOutput` on the next call —
this repo does not persist pipeline output anywhere when run via Vercel; save the responses
yourself if you need a record of them.

Setup (Vercel dashboard → Add New Project → import this GitHub repo):
1. **Root Directory**: `marketing` (this subfolder only — not the repo root).
2. **Environment Variables**:
   - `ANTHROPIC_API_KEY` — real key, same as local `.env`.
   - `MARKETING_TRIGGER_SECRET` — a long random value (`openssl rand -hex 32`). Required —
     `api/run.js` refuses every request without a matching `x-trigger-secret` header. Without
     this, anyone who finds the URL can spend your Claude API credits.
3. Deploy. Vercel auto-detects `api/run.js` as a Node serverless function (no build step
   needed for this repo — there's no frontend to build here).

Calling it once deployed:
```bash
curl -X POST https://<your-project>.vercel.app/api/run \
  -H "content-type: application/json" \
  -H "x-trigger-secret: <MARKETING_TRIGGER_SECRET>" \
  -d '{"step":"scout"}'

# chain planner off scout's output:
curl -X POST https://<your-project>.vercel.app/api/run \
  -H "content-type: application/json" \
  -H "x-trigger-secret: <MARKETING_TRIGGER_SECRET>" \
  -d '{"step":"planner","previousOutput": <scout response .output> }'
```
Valid `step` values: `scout`, `planner`, `hook-writer`, `content-writer`, `repurposer` (same
order as `config.js`'s `PIPELINE_STEPS`). `dm-manager` and `analyst` are not yet exposed as
API routes — they're CLI-only today; same `agentRunner.js` pattern would extend to them if
needed.

This is a manually-triggered HTTP endpoint, not a cron job. If you want it to run
automatically on a schedule, add a [Vercel Cron Job](https://vercel.com/docs/cron-jobs)
(`vercel.json` → `crons`) that calls it — not set up yet since nothing in the current spec
said how often to run it.

## Automated daily posting (launchd)

`pipeline/daily-post.js` posts to LinkedIn **unattended** every day at 9:00 AM PKT via a
macOS LaunchAgent (`~/Library/LaunchAgents/com.dsp.marketing.dailypost.plist` — not in this
repo). It regenerates content fresh each morning, picks the calendar item matching today's
weekday, and publishes ONLY if two gates pass: a placeholder check and the adversarial
Verifier agent (`agents/09-verifier.md`) that blocks any claim unsupported by
`knowledge/dsp/` — a blocked day posts nothing. Logs to `output/daily-post.log` +
`output/dsp/<date>/published.md`.

- Change the time: edit the plist's Hour/Minute, then `launchctl unload && launchctl load` it.
- **Kill switch:** `launchctl unload ~/Library/LaunchAgents/com.dsp.marketing.dailypost.plist`
- Test without posting: `DAILY_POST_DRY_RUN=1 node pipeline/daily-post.js`
- The Mac must be awake at 9 AM; launchd runs a missed job on wake the same day.

## Auto-posting to LinkedIn and TikTok

`pipeline/linkedin.js` and `pipeline/tiktok.js` are real API clients (LinkedIn Posts API,
TikTok Content Posting API) — not stubs — but neither can go live until you've done some
setup on the platform side that I cannot do for you:

**LinkedIn** (`publishLinkedInPost`, text-only, no video needed):
1. Create an app at [developer.linkedin.com](https://www.linkedin.com/developers/apps),
   request the `w_member_social` scope, complete OAuth 2.0 to get an access token tied to
   your own profile (`urn:li:person:...`).
2. Posting as a **company page** instead of your profile (`urn:li:organization:...`) needs
   LinkedIn's separate Community Management API partnership approval — apply for that only
   if profile posting isn't enough.
3. Put the token and URN in `marketing/.env` (`LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN`)
   or as Vercel env vars, then `npm run marketing:publish -- --asset=<path> --linkedin`.
4. Access tokens expire (60 days for the standard 3-legged flow) — there's no refresh-token
   handling in `linkedin.js` yet; re-auth manually when it expires, or add refresh logic if
   this becomes routine.

**TikTok** (`publishTikTokVideo`, needs an actual video file, not a script):
1. `tiktok_script` from Repurposer is a **shot list** — a human or a video-generation tool
   still has to actually film/render it into an .mp4 hosted at a public URL. Nothing in this
   repo does that rendering step.
2. Create an app at [developers.tiktok.com](https://developers.tiktok.com/), request the
   Content Posting API and `video.publish` scope, complete OAuth to get an access token.
3. **Until TikTok audits and approves your app for public posting, every post is forced to
   `privacy_level: SELF_ONLY`** — it lands as a private draft in your own TikTok inbox, not
   published to your public profile. `tiktok.js` defaults to `SELF_ONLY` for exactly this
   reason; don't override it until TikTok confirms your app passed audit.
4. Once you have a rendered video at a public URL:
   `npm run marketing:publish -- --asset=<path> --tiktok --video-url=<url>`.

Treat both of these as "wire up once you have real platform credentials," not "works out of
the box" — I can't create LinkedIn/TikTok developer apps or pass TikTok's audit on your
behalf.
