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
- `output/` — gitignored. Every pipeline run writes JSON + a human-readable `.md` per step to
  `output/dsp/<YYYY-MM-DD>/`.

## Why plain JS, not TypeScript

The rest of this repo (backend/, vite-app/) has no `tsconfig.json` and no `typescript`
dependency anywhere — backend is CommonJS, vite-app is JS/JSX. This module matches that:
plain `.js`, CommonJS (`require`/`module.exports`), so no new toolchain is introduced for one
module. If TypeScript is ever adopted repo-wide, this is the module to convert first since
`schema.js` is already typedef-shaped.

## Why `businessUnit` exists on Lead

The original Lead model had no concept of business unit — ASOS is multi-*tenant*
(one tenant = one customer org), not multi-*business-unit*. `businessUnit` was added as a
plain string column (`@default("DSP")`) rather than an enum, specifically so a second
business unit is just a new string value, not a migration. See
`backend/prisma/migrations/20260707000000_add_business_unit_to_leads/`.

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
