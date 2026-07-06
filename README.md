# AI Sales OS (ASOS)

AI Sales Operating System — multi-tenant WhatsApp sales pipeline (Node.js/Express/Prisma
backend, React/Vite dashboard) with an AI qualifier/closer agent pair handling inbound leads.

- `backend/` — API (see [backend/README.md](backend/README.md)).
- `vite-app/` — dashboard.
- `frontend/` — marketing/auth static pages.
- `deploy/`, `nginx/`, `infrastructure/` — deployment.
- `marketing/` — DSP demand-generation system (below).

## DSP Marketing System

An 8-agent content pipeline for **DSP (AI Agents Bootcamp)** — digitalservicesprogram.com —
that generates demand and feeds leads into the ASOS sales pipeline above. It's one business
unit; `marketing/knowledge/dsp/` is scoped so a second business unit can be added later
without refactoring.

Pipeline: Scout → Planner → Hook Writer → Content Writer → Repurposer (sequential content
generation), plus standalone DM Manager (scores inbound DMs, creates real leads) and
Sales/Closer (drafts follow-up sequences), and Analyst (weekly performance report). Full
agent job descriptions live in `marketing/agents/*.md` — each also works standalone as an
Anthropic Console system prompt.

DSP leads land in the real ASOS leads API (`backend/src/modules/leads`), tagged with the
existing `businessUnit` enum (`LeadBusinessUnit.DSP`). No new database or service — see
`marketing/CLAUDE.md` for the integration details.

### Quickstart

```bash
cd marketing
npm install
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, and MARKETING_API_EMAIL/PASSWORD for lead handoff

npm run marketing -- --step=all              # full content pipeline
npm run marketing -- --step=scout            # single step
npm run marketing:dm -- --message="how do I join the next batch?"
npm run marketing:analyst -- --metrics=path/to/metrics.csv
```

Output is written to `marketing/output/dsp/<YYYY-MM-DD>/` (gitignored).
