# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout (what's live, what's legacy)

- `backend/` — Node.js / Express / Prisma / PostgreSQL / Redis / BullMQ. **API server and worker are separate processes** that share `backend/src/` but are launched via different entrypoints.
  - `backend/backend/` — duplicate/nested directory that mirrors `backend/`; treat as an artifact, not canonical source.
- `vite-app/` — **The current React SPA** (Vite + Tailwind + Zustand + React Router v6). This is the dashboard served to users.
- `frontend/` — **Legacy** static-HTML prototype (`ASOS-Auth.html`, `ASOS-Dashboard.html`, `src/App.jsx` using `window.*` globals via CDN React). Superseded by `vite-app/`; nginx no longer serves this directory. Safe to delete.
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
npm run db:seed            # seed demo tenant + users (see credentials below)
npm run db:studio          # prisma studio GUI
npx prisma migrate dev --name <change_name>   # new migration in development
```
You **must** run both `npm run dev` AND `npm run worker` for inbound WhatsApp messages to be processed — the API only enqueues, the worker drains the queue.

**Seed credentials (after `npm run db:seed`):**
- Superadmin: `superadmin@asos.io` / `superadmin123!`
- Demo tenant admin: `admin@demo-empresa.com` / `admin123!`
- Demo agent: `agent@demo-empresa.com` / `agent123!`

### Frontend (`cd vite-app`)
```bash
npm install
npm run dev      # vite on :3001 (proxies /api, /webhooks, /uploads → :3000)
npm run build    # → vite-app/dist
npm run preview  # serve built bundle on :3001
npm run lint
```

### Full stack via Docker
```bash
cp .env.local.example .env          # fill in ANTHROPIC_API_KEY; rest uses mock defaults
docker compose --env-file .env up -d
docker compose exec api npx prisma migrate deploy
docker compose exec api node prisma/seed.js
```
The `migrate` service runs `prisma migrate deploy` once and exits. `api` and `worker` are built from `backend/Dockerfile` and `backend/Dockerfile.worker` respectively.

### Mock / local dev without WhatsApp
Set `WHATSAPP_MOCK=true` in your env. This:
1. Skips all Meta API calls — no WA tokens needed
2. Mounts `/api/v1/dev/inject-message` for simulating inbound messages
3. Claude still processes all messages and writes replies to DB

Dev routes are mounted in `src/app.js` only when `WHATSAPP_MOCK=true`.

### No test suite is currently wired up
There is no `npm test` or test runner. Don't claim tests pass — say "no tests configured" and point to manual verification.

## Big-picture architecture

### Inbound message flow (the system's core path)
```
WhatsApp Cloud → POST /webhooks/whatsapp (HMAC-verified, raw body)
              → publishInboundMessage() → BullMQ "asos-messages" queue
              → conversation.worker.js processInboundMessage():
                  1. Load tenant (WA creds + aiConfig)
                  2. Resolve/create Contact, Lead, Conversation
                  3. Persist inbound Message
                  4. Skip if conversation.aiEnabled === false
                  5. claudeService.processMessage()  ← dual-agent pipeline
                  6. Update Lead (stage, score, intent, problemSummary…)
                  7. Log STAGE_CHANGE + AI_ACTION Activities
                  8. Send WA reply OR handoff OR close
                  9. Fire Meta CAPI events (trackLead/Qualified/Purchase)
```
The API server **never** calls Claude directly for inbound messages — everything goes through the queue. Synchronous Claude calls only happen for `/conversations/:id/summary` and `/ai/config/test`.

### Dual-agent AI (`backend/src/services/claude.service.js`)
This is **v1.5** and is the load-bearing piece — read it before changing AI behavior:
- **Qualifier** (default `claude-haiku-4-5`, `temperature: 0`) — analyzes message + history, returns strict JSON `{lead_status, score 1-10, intent, problem_summary, next_action}`. Pure analysis, no copy.
- **Closer** (default `env.CLOSER_MODEL || claude-3-5-sonnet-20241022`) — generates the WhatsApp reply given Qualifier output. Returns `{reply_message, closing_type, urgency_trigger}`.
- Pipeline is **sequential**. If Qualifier fails → handoff with no Closer call. If Qualifier says `next_action === "handoff_human"` → skip Closer, route to human. If Closer fails → handoff but keep Qualifier output for stage update.
- Both outputs land in `AiAgentLog` (audit trail for the future Analyst AI v2). Token usage is incremented on `Subscription.aiTokensUsed`.
- **Strict fact rule (in the Closer prompt):** the Closer is forbidden from inventing facts not present in `aiConfig.systemPrompt`. Fabricated dividend %, certifications, scarcity, etc. is the explicit thing being prevented.
- `processMessage()` returns a v1-compatible shape so the worker's contract is preserved; v1.5 fields (`humanFollowupRequired`, `intent`, `qualifierOutput`, `closerOutput`) are additive.
- `generateSummary()` is a separate Claude call (no dual-agent) used by the Conversations page summary endpoint.

Model env vars:
```
QUALIFIER_MODEL   # defaults to claude-haiku-4-5
CLOSER_MODEL      # defaults to CLAUDE_MODEL or claude-3-5-sonnet-20241022
CLAUDE_MODEL      # fallback for Closer and generateSummary
```

### Stage progression
`deriveStage()` in `claude.service.js` is **monotonic** — it never moves a lead backwards through `NEW → QUALIFYING → DIAGNOSED → PROPOSED → CLOSED_WON/LOST`. New AI logic must respect this.

### Multi-tenancy (non-negotiable)
- Every domain table has `tenantId`. Every Prisma query in module code must include `tenantId` in the `where` clause — there is no row-level security fallback.
- `req.tenantId` and `req.tenant` are populated by `auth.middleware.js` from the JWT. `requireActiveTenant` (in `tenant.middleware.js`) blocks SUSPENDED/CANCELLED tenants.
- WhatsApp + Meta credentials are **per-tenant** columns on `Tenant` (not global env). The worker passes the loaded `tenant` object into `whatsappService.sendText(tenant, ...)` — never read WA creds from env at request time.
- WA creds are **encrypted at rest** via `utils/crypto.js` (AES-256-GCM, keyed from `JWT_SECRET`). Settings routes that update WA creds must encrypt before write and decrypt before passing to `whatsappService`.

### Backend module pattern
Each `src/modules/<name>/` has `<name>.routes.js` + `<name>.controller.js` + `<name>.service.js`. Routes wire middleware (`authenticate`, `authorize('TENANT_ADMIN')`, `requireActiveTenant`), controllers parse/validate with Zod and shape responses via `utils/response.js`, services hold all Prisma logic. Keep this split — don't put Prisma calls in controllers.

**API modules:**
| Module | Route prefix | Notes |
|---|---|---|
| auth | `/api/v1/auth` | Stricter rate limit (20/15min) |
| leads | `/api/v1/leads` | Pipeline, hot leads, DSP sync |
| contacts | `/api/v1/contacts` | |
| conversations | `/api/v1/conversations` | AI toggle, takeover, handback |
| campaigns | `/api/v1/campaigns` | Meta Ads campaign tracking |
| analytics | `/api/v1/analytics` | Funnel, revenue, AI performance |
| users | `/api/v1/users` | Invite, role; TENANT_ADMIN only |
| settings | `/api/v1/settings` | WA credentials, Meta config |
| ai-config | `/api/v1/ai` | Qualifier/Closer config, test |
| billing | `/api/v1/billing` | Stripe integration |
| admin | `/api/v1/admin` | SUPERADMIN only |
| content-studio | `/api/v1/content-studio` | AI ad content + image generation |
| reports | `/api/v1/reports` | Client performance reports |
| dev | `/api/v1/dev` | Only when `WHATSAPP_MOCK=true` |

### Express bootstrap subtleties (`src/app.js`)
- `/api/*` uses JSON body parsing; `/webhooks/*` uses **raw body** (`express.raw`) because WhatsApp + Stripe HMAC verification needs the unmodified bytes. Don't move webhook routes under `/api`.
- Auth endpoints have a **stricter** rate limiter (20/15min) layered on top of the global limiter (300/15min).
- `env.js` validates all env vars with Zod at boot; missing/invalid vars **crash the process**. Add new vars there, not ad-hoc `process.env.X` reads.
- `/uploads` is served via `express.static` as a fallback; in production nginx serves this path directly from the shared Docker volume.

### Server startup quirk
`server.js` checks `redis.status === 'wait'` before connecting because importing `queues/message.queue.js` (via the worker) auto-initializes the BullMQ Redis connection. Don't call `redis.connect()` unconditionally.

### DSP integration (`leads` module)
The leads service contains a MySQL connector (`mysql2`) for syncing student records from a legacy DSP EdTech CRM:
- Env vars: `DSP_DB_HOST`, `DSP_DB_PORT`, `DSP_DB_NAME`, `DSP_DB_USER`, `DSP_DB_PASSWORD`
- `POST /api/v1/leads/sync-dsp` triggers the sync; imported contacts have `customFields.source = "DSP_CRM"`
- DSP-specific Lead fields: `dspPhase` (LEARN/BUILD/EARN), `enrollmentFee`
- The `fromDsp` query param on `GET /leads` and `/leads/pipeline` filters to DSP-sourced contacts
- `backend/prisma/seed-dsp.js` seeds DSP-specific demo data

### Content Studio (`content-studio` module)
AI-driven ad content generation pipeline:
- `POST /content-studio/extract` — SSRF-safe URL extraction of brand info; validates against private IP ranges, blocked hostnames (loopback, cloud metadata), non-standard ports
- `POST /content-studio/generate` — generates up to 20 content variants across channels: `meta_ad`, `whatsapp_message`, `instagram_caption`, `email`
- `POST /content-studio/image` / `drafts/:id/image` — Replicate API (Flux-dev model) for image generation; requires `REPLICATE_API_TOKEN`
- Draft lifecycle: GENERATED → SAVED → PUBLISHED / SENT_FOR_APPROVAL
- `BrandProfile` stores extracted brand data per tenant; `ContentSession` groups variants from one extraction run

### Frontend (`vite-app`)
- React Router v6 with **lazy-loaded pages** (`React.lazy` in `main.jsx`). All app pages live under a `<PrivateRoute>` guarded by `localStorage.asos_token` via `useAuthStore`.
- Single Axios instance in `src/lib/api.js` with a request interceptor (attach JWT) and response interceptor (auto-refresh on 401, then redirect to `/auth`). New API calls should be added as a method on the relevant `*API` object, not as ad-hoc `axios.get` calls in components.
- Auth state lives in Zustand (`src/stores/auth.store.js`) with localStorage persistence under key `asos_auth`. `setAuth({ accessToken, refreshToken, user, tenant })` is the only setter.
- Path aliases: `@`, `@components`, `@pages`, `@lib`, `@stores` (see `vite.config.js`). Use them; relative `../../../` paths break lazy chunks.
- Vite dev server proxies `/api`, `/webhooks`, and `/uploads` to `localhost:3000`.
- Google OAuth is optional — wrapped with `<GoogleOAuthProvider>` only if `VITE_GOOGLE_CLIENT_ID` is set.

**Dashboard pages:**
| Route | Component | Notes |
|---|---|---|
| `/dashboard` | Dashboard.jsx | KPI overview |
| `/leads` | Pipeline.jsx | Kanban by stage |
| `/conversations` | Conversations.jsx | Real-time chat UI |
| `/ai-insights` | AIInsights.jsx | Qualifier/Closer analytics |
| `/ads` | AdsPerformance.jsx | Meta Ads dashboard |
| `/analytics` | Analytics.jsx | Funnel + revenue |
| `/students` | Students.jsx | DSP EdTech students |
| `/dsp-reports` | DSPReports.jsx | DSP performance reports |
| `/automations` | Automations.jsx | Automation workflows |
| `/settings` | Settings.jsx | WA config, AI config |
| `/billing` | Billing.jsx | Stripe subscription |
| `/onboarding` | Onboarding.jsx | First-run wizard |

## Data model summary (Prisma schema)

Key models and their purpose:
- **Tenant** — multi-tenant root; holds WA creds (encrypted), Meta Pixel, Stripe ID, per-tenant settings JSON
- **User** — SUPERADMIN (no tenantId) | TENANT_ADMIN | AGENT; Google OAuth supported
- **Contact** — phone (E.164, unique per tenant), name, tags, customFields
- **Lead** — CRM record; stage (NEW→QUALIFYING→DIAGNOSED→PROPOSED→CLOSED), aiScore (0-100), v1.5 fields: `intent`, `problemSummary`, `nextAction`, `humanFollowupRequired`, `leadTemperature`
- **Conversation** — one per WA thread; `aiEnabled` flag, `status` (ACTIVE/AI_HANDLING/HUMAN_TAKEOVER/CLOSED)
- **Message** — every WA message in/out; `waMessageId` is globally unique (dedup key); outbound messages store `aiRawResponse` JSON
- **AiAgentLog** — raw Qualifier + Closer outputs per message; audit trail for future Analyst AI v2
- **AiConfig** — per-tenant dual-agent configuration (systemPrompt, qualificationCriteria, handoffTriggers, closingScript, model overrides)
- **Activity** — CRM timeline events; `STAGE_CHANGE` and `AI_ACTION` types must stay separate (analytics queries depend on this distinction)
- **Campaign** — Meta Ads campaign tracking with spend/impressions/conversions
- **AdsTracking** — per-lead Meta attribution from Click-to-WhatsApp referral data; stores `eventsSent` array
- **Subscription** — billing + `aiTokensUsed` (BigInt) incremented per dual-agent run
- **BrandProfile**, **ContentSession**, **ContentDraft** — Content Studio pipeline
- **ClientReport** — generated reports (stored as files in `uploads/reports/`) optionally sent via WhatsApp

## Things that bite

- **Two Redis consumers, one URL.** `messageQueue` (publisher in API) and `Worker` (subscriber in worker) both use the shared `redis` client from `config/redis.js`. Don't `redis.quit()` in handlers.
- **`waMessageId` dedup.** `publishInboundMessage` sets `jobId: msg:${waMessageId}` so duplicate webhook deliveries from Meta are idempotent. Don't override `jobId` when adding new producers.
- **Stage activity logging** is split across `STAGE_CHANGE` (lifecycle) and `AI_ACTION` (per-message) Activity rows — both are written in `conversation.worker.js`. Keep them separate; analytics queries depend on the type distinction.
- **Encrypted-at-rest WA tokens.** `utils/crypto.js` does AES-256-GCM using `JWT_SECRET` as the key derivation secret. Settings routes that update WA creds must encrypt before write and decrypt before passing to `whatsappService`.
- **Prisma migrations.** Schema lives in `backend/prisma/schema.prisma`. After editing the schema, run `npx prisma migrate dev --name <change>` locally — don't hand-edit migration SQL.
- **`express.raw` on `/webhooks`.** Body parsing for webhook routes uses raw bytes — JSON parsing is NOT applied there. WhatsApp and Stripe handlers must handle the raw buffer themselves.
- **Content Studio SSRF guard.** `content-studio.service.js` validates URLs against private IP ranges, blocked hostnames (`localhost`, cloud metadata endpoints), and only allows ports 80/443. Don't bypass this when adding new URL-fetching features.
- **`backend/backend/` nested duplicate.** There's a `backend/backend/` directory that mirrors `backend/` — treat as legacy. All active development happens in `backend/src/`.
- **Uploads path.** In dev, `/uploads` is proxied through Vite to the API. In production, nginx serves it directly from the shared Docker volume. Use `resolveUploadUrl()` from `src/lib/api.js` in the frontend when constructing upload URLs — it handles both cases.

## Environment variables

Required at boot (crashes if missing):
```
DATABASE_URL          postgresql://...
REDIS_URL             redis://...
JWT_SECRET            ≥32 chars
JWT_REFRESH_SECRET    ≥32 chars
ANTHROPIC_API_KEY     sk-ant-...
```

Optional with defaults:
```
QUALIFIER_MODEL       default: claude-haiku-4-5
CLOSER_MODEL          default: CLAUDE_MODEL || claude-3-5-sonnet-20241022
CLAUDE_MODEL          default: claude-3-5-sonnet-20241022
WHATSAPP_MOCK         true|false (default: false)
REPLICATE_API_TOKEN   required for Content Studio image generation
STRIPE_SECRET_KEY     required for billing
GOOGLE_CLIENT_ID      backend Google OAuth (frontend: VITE_GOOGLE_CLIENT_ID)
DSP_DB_HOST/PORT/NAME/USER/PASSWORD  required for DSP CRM sync
PUBLIC_UPLOADS_BASE   set in production when SPA host ≠ API host
```

## Deploy scripts (`deploy/`)

Run on the server inside the deploy dir (default `/opt/asos`):
- `setup.sh` — one-time provisioning: installs Docker, configures UFW/fail2ban, gets SSL certs, builds the SPA, starts containers.
- `bootstrap-git.sh` — one-time conversion of an rsync'd dir into a git checkout, so `update.sh` can pull from origin.
- `update.sh` — pull `origin/main`, rebuild only what changed (api/worker images, vite-app SPA), run pending migrations, reload nginx, health-check. Requires a clean working tree.
- `rollback.sh <commit-ish> [--force]` — `git reset --hard` to the target SHA, rebuild + restart. Refuses to roll back across new Prisma migrations unless `--force`.

## Docker Compose services (production)

| Service | Image | Notes |
|---|---|---|
| postgres | postgres:16-alpine | Port 5432 (localhost only) |
| redis | redis:7-alpine | 256MB, noeviction policy |
| api | backend/Dockerfile | Port 3000 (localhost only) |
| worker | backend/Dockerfile.worker | No exposed port |
| migrate | backend/Dockerfile | Runs `prisma migrate deploy`, exits |
| nginx | nginx:alpine | Ports 80/443, SSL termination, SPA serving |
| certbot | certbot/certbot | Auto SSL renewal every 12h |

Networks: `asos_internal` (backend services, no external access) and `asos_external` (nginx only). The `uploads_data` volume is shared between `api` (write) and `nginx` (read) for generated images.
