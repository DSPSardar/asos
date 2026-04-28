# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout (what's live, what's legacy)

- `backend/` — Node 22 / Express 5 / Prisma / PostgreSQL / Redis / BullMQ. **API server and worker are separate processes** that share `backend/src/` but are launched via different entrypoints.
- `vite-app/` — **The current React SPA** (Vite + Tailwind + Zustand + React Router). This is what gets served as the dashboard.
- `frontend/` — **Legacy** static-HTML prototype (`ASOS-Auth.html`, `ASOS-Dashboard.html`, `src/App.jsx` using `window.*` globals via CDN React). Superseded by `vite-app/`; nginx no longer serves this directory. Kept in-repo for reference; safe to delete.
- Top-level `*.html` files (`getaisales-Landing.html`, `about.html`, `ASOS-v1-*.html`, etc.) are the **marketing site / docs**, served statically.
- `infrastructure/init.sql`, `nginx/nginx.conf`, `deploy/setup.sh` — production deployment scaffolding.

## Common commands

### Backend (`cd backend`)
```bash
npm install
npm run dev                # nodemon — API on :3000
npm run worker             # BullMQ conversation worker (separate process)
npm run lint               # eslint src/
npm run db:migrate         # prisma migrate deploy (production)
npm run db:generate        # regenerate Prisma client after schema.prisma edits
npm run db:seed            # seed demo tenant + users (see backend/README.md for creds)
npm run db:studio          # prisma studio GUI
npx prisma migrate dev --name <change_name>   # new migration in development
```
You **must** run both `npm run dev` AND `npm run worker` for inbound WhatsApp messages to be processed — the API only enqueues, the worker drains the queue.

### Frontend (`cd vite-app`)
```bash
npm install
npm run dev      # vite on :3001 (proxies /api and /webhooks → :3000)
npm run build    # → vite-app/dist
npm run preview  # serve built bundle on :3001
npm run lint
```

### Full stack via Docker
```bash
cp .env.production.example .env.production   # fill in secrets
docker compose --env-file .env.production up -d
```
The `migrate` service runs `prisma migrate deploy` once and exits. `api` and `worker` are built from `backend/Dockerfile` and `backend/Dockerfile.worker` respectively.

### No test suite is currently wired up
There is no `npm test` script or test runner installed. Don't claim tests pass — say "no tests configured" and point to manual verification.

## Big-picture architecture

### Inbound message flow (the system's core path)
```
WhatsApp Cloud → POST /webhooks/whatsapp (HMAC-verified, raw body)
              → publishInboundMessage() → BullMQ "asos-messages" queue
              → conversation.worker.js processInboundMessage():
                  1. Resolve/create Contact, Lead, Conversation
                  2. Persist inbound Message
                  3. Skip if conversation.aiEnabled === false
                  4. claudeService.processMessage()  ← dual-agent pipeline
                  5. Update Lead (stage, score, intent, problemSummary…)
                  6. Send WA reply OR handoff OR close
                  7. Fire Meta CAPI events (trackLead/Qualified/Purchase)
```
The API server **never** calls Claude directly for inbound messages — everything goes through the queue. Synchronous Claude calls only happen for `/conversations/:id/summary` and `/ai/config/test`.

### Dual-agent AI (`backend/src/services/claude.service.js`)
This is **v1.5** and is the load-bearing piece — read it before changing AI behavior:
- **Qualifier** (default `claude-haiku-4-5`, `temperature: 0`) — analyzes message + history, returns strict JSON `{lead_status, score 1-10, intent, problem_summary, next_action}`. Pure analysis, no copy.
- **Closer** (default `env.CLOSER_MODEL || claude-3-5-sonnet-20241022`) — generates the WhatsApp reply given Qualifier output. Returns `{reply_message, closing_type, urgency_trigger}`.
- Pipeline is sequential. If Qualifier fails → handoff with no Closer call. If Qualifier says `next_action === "handoff_human"` → skip Closer, route to human. If Closer fails → handoff but keep Qualifier output for stage update.
- Both outputs land in `AiAgentLog` (audit trail for the future Analyst AI v2). Token usage is incremented on `Subscription.aiTokensUsed`.
- **Strict fact rule (in the Closer prompt):** the Closer is forbidden from inventing facts not present in `aiConfig.systemPrompt`. When editing prompts, preserve this — fabricated dividend %, certifications, scarcity, etc. is the explicit thing being prevented.
- `processMessage()` returns a v1-compatible shape so the worker's contract is preserved; v1.5 fields (`humanFollowupRequired`, `intent`, `qualifierOutput`, `closerOutput`) are additive.

### Stage progression
`deriveStage()` in `claude.service.js` is **monotonic** — it never moves a lead backwards through `NEW → QUALIFYING → DIAGNOSED → PROPOSED → CLOSED_WON/LOST`. New AI logic must respect this.

### Multi-tenancy (non-negotiable)
- Every domain table has `tenantId`. Every Prisma query in module code must include `tenantId` in the `where` clause — there's no row-level security fallback.
- `req.tenantId` and `req.tenant` are populated by `auth.middleware.js` from the JWT. `requireActiveTenant` (in `tenant.middleware.js`) blocks SUSPENDED/CANCELLED tenants.
- WhatsApp + Meta credentials are **per-tenant** columns on `Tenant` (not global env). The worker passes the loaded `tenant` object into `whatsappService.sendText(tenant, ...)` — never read WA creds from env at request time.

### Backend module pattern
Each `src/modules/<name>/` has `<name>.routes.js` + `<name>.controller.js` + `<name>.service.js`. Routes wire middleware (`authenticate`, `authorize('TENANT_ADMIN')`, `requireActiveTenant`), controllers parse/validate with Zod and shape responses via `utils/response.js`, services hold Prisma logic. Keep this split — don't put Prisma calls in controllers.

### Express bootstrap subtleties (`src/app.js`)
- `/api/*` uses JSON body parsing; `/webhooks/*` uses **raw body** (`express.raw`) because WhatsApp + Stripe HMAC verification needs the unmodified bytes. Don't move webhook routes under `/api`.
- Auth endpoints have a **stricter** rate limiter (20 / 15min) layered on top of the global limiter (300 / 15min).
- `env.js` validates all env vars with Zod at boot; missing/invalid vars **crash the process**. Add new vars there, not ad-hoc `process.env.X` reads.

### Server startup quirk
`server.js` checks `redis.status === 'wait'` before connecting because importing `queues/message.queue.js` (via the worker) auto-initializes the BullMQ Redis connection. Don't call `redis.connect()` unconditionally.

### Frontend (`vite-app`)
- React Router v6 with **lazy-loaded pages** (`React.lazy` in `main.jsx`). All app pages live under a `<PrivateRoute>` guarded by `localStorage.asos_token`.
- Single Axios instance in `src/lib/api.js` with a request interceptor (attach JWT) and response interceptor (auto-refresh on 401, then redirect to `/auth`). New API calls should be added as a method on the relevant `*API` object, not as ad-hoc `axios.get` calls in components.
- Auth state lives in Zustand (`src/stores/auth.store.js`). `setAuth({ accessToken, refreshToken, user, tenant })` is the only setter.
- Path aliases: `@`, `@components`, `@pages`, `@lib`, `@stores` (see `vite.config.js`). Use them; relative `../../../` paths break the lazy chunks.
- Vite dev server proxies `/api` and `/webhooks` to `localhost:3000`, so the SPA expects the backend on that port in dev.

## Things that bite

- **Two Redis consumers, one URL.** `messageQueue` (publisher in API) and `Worker` (subscriber in worker) both use the shared `redis` client from `config/redis.js`. Don't `redis.quit()` in handlers.
- **`waMessageId` dedup.** `publishInboundMessage` sets `jobId: msg:${waMessageId}` so duplicate webhook deliveries from Meta are idempotent. Don't override `jobId` when adding new producers.
- **Stage activity logging** is split across `STAGE_CHANGE` (lifecycle) and `AI_ACTION` (per-message) Activity rows — both are written in `conversation.worker.js`. Keep them separate; analytics queries depend on the type distinction.
- **Encrypted-at-rest WA tokens.** `utils/crypto.js` does AES-256-GCM. Settings routes that update WA creds must encrypt before write and decrypt before passing to `whatsappService`.
- **Prisma migrations.** Schema lives in `backend/prisma/schema.prisma`; only `0_init` is checked in. After editing the schema, run `npx prisma migrate dev --name <change>` locally — don't hand-edit migration SQL.

## Deploy scripts (`deploy/`)

Run on the server inside the deploy dir (default `/opt/asos`):
- `setup.sh` — one-time provisioning. Installs Docker, configures UFW/fail2ban, gets SSL certs, builds the SPA, starts containers.
- `bootstrap-git.sh` — one-time conversion of an rsync'd dir into a git checkout, so `update.sh` can pull from origin.
- `update.sh` — pull `origin/main`, rebuild only what changed (api/worker images, vite-app SPA), run pending migrations, reload nginx, health-check. Requires a clean working tree.
- `rollback.sh <commit-ish> [--force]` — `git reset --hard` to the target SHA, rebuild + restart. Refuses to roll back across new Prisma migrations unless `--force`.
