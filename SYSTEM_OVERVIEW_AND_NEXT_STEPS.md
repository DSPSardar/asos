# ASOS System Overview, Scope, and Next Steps

This document explains how the system works today, what is currently in scope, the key business logic, and what to do next.

---

## 1) What ASOS Is

ASOS is a multi-tenant AI sales operating system for WhatsApp-first lead handling.

At a high level:
- Inbound WhatsApp messages enter the backend through webhooks.
- Messages are queued in Redis/BullMQ.
- A worker processes messages, updates lead state, and can generate AI replies.
- The React dashboard shows leads, conversations, and analytics.
- Leads can also be imported from an external DSP CRM MySQL database.

---

## 2) Current Runtime Architecture

Main components in production:

- `api` (Node/Express): REST API, auth, webhook entry, queue publish.
- `worker` (Node): queue consumer, AI pipeline, lead/conversation progression.
- `postgres`: primary app database via Prisma.
- `redis`: queue + realtime infra for jobs.
- `vite-app` build artifacts: served by web server (Apache/Nginx setup on host).

Important separation:
- API receives inbound events and enqueues.
- Worker does the heavy processing and outbound actions.

---

## 3) Current Functional Scope (What Works Now)

### Leads
- List leads from DB (tenant-scoped).
- Filter/search leads.
- DSP-only filter (`fromDsp=1`) supported in backend and UI.
- Change lead stage.
- Mark lead as won.
- Add lead note.
- Update deal value.
- Create new leads manually from UI.
- Sync leads from DSP CRM (MySQL) into ASOS.

### DSP CRM Sync
- Source DB: MySQL/MariaDB table `users`.
- Query used:
  - `name`
  - `email`
  - `phone_number`
  - `is_phone_verified`
- Sync behavior:
  - Normalizes phone.
  - Skips rows with invalid/missing phone.
  - Dedupes by tenant + phone/email against existing contacts.
  - Creates contact + lead + activity log for new records.
  - Tags imported records with `customFields.source = "DSP_CRM"`.

### Conversations / AI (already existing)
- Inbound messages go through queue + worker.
- AI qualifier/closer logic updates lead qualification and replies (when enabled).
- Human handoff path exists.

---

## 4) Key Business Logic and Guardrails

### Multi-tenancy (critical)
- Every lead/contact/conversation query is tenant scoped.
- Never mix tenant data.

### Lead progression
- Backend stage semantics are canonical:
  - `NEW`
  - `QUALIFYING`
  - `DIAGNOSED`
  - `PROPOSED`
  - `CLOSED_WON`
  - `CLOSED_LOST`
- UI currently maps these to simpler labels (`NEW`, `QUALIFIED`, `PROPOSAL`, `WON`, `LOST`).

### DSP import source of truth
- DSP-imported records are identified by `contact.customFields.source = "DSP_CRM"`.
- UI “DSP CRM” source filter relies on this field.

### Operational requirement for DSP sync
- API container must reach MySQL host/port.
- DB user must allow Docker client host (`%` or Docker subnet host mask).
- Credentials in `.env.production` must match MySQL user exactly.

---

## 5) Deployment Model (Current Working Flow)

Typical deploy on server:
1. `git pull --ff-only origin main`
2. Rebuild/restart `api` and `worker` with `.env.production`
3. Build `vite-app` and copy `dist` to web root
4. Check API health endpoint

For DSP sync specifically:
- `DSP_DB_HOST`, `DSP_DB_PORT`, `DSP_DB_NAME`, `DSP_DB_USER`, `DSP_DB_PASSWORD` must be set.
- If host MySQL is used from Docker, `host.docker.internal` + `extra_hosts: host-gateway` is configured.

---

## 6) Known Constraints / Gaps

- No automated test suite is configured yet.
- Leads page still has some UI placeholders (e.g., deeper reassign workflow).
- Lead detail timeline/messages are simplified in UI and not yet full conversation history.
- Search/filter is partially server-driven and partially client-side for presentation concerns.

---

## 7) Recommended Next Steps (Priority Order)

### Phase A: Stabilize current lead operations
1. Add explicit success/error toasts for all lead actions (stage, note, value, sync).
2. Add optimistic update + rollback for stage changes to improve UX.
3. Add backend validation messages surfaced cleanly in UI.

### Phase B: Make Leads fully production-grade
1. Replace placeholder detail content with real conversation/activity API data.
2. Add agent reassignment UI wired to backend assign endpoint.
3. Add pagination controls to lead list/table.
4. Add sort parameters server-side for consistent large dataset behavior.

### Phase C: Hardening and observability
1. Add structured metrics for DSP sync runs (duration, inserted/skipped/invalid).
2. Add idempotent sync windowing options (e.g., incremental by updated_at when possible).
3. Add audit events for manual lead updates.

### Phase D: Testing and release safety
1. Add backend integration tests for leads endpoints and DSP sync.
2. Add smoke tests for UI lead actions.
3. Add deployment checklist automation (health + critical endpoint checks).

---

## 8) Immediate “What Should I Do Next?”

If your goal is reliability and faster iteration, do this next:

1. Finalize lead detail to show real activities/conversation snippets.
2. Add reassignment flow in UI.
3. Add server-side pagination/sorting to avoid loading all leads at once.
4. Add basic test coverage for:
   - `POST /leads/sync-dsp`
   - `PATCH /leads/:id/stage`
   - `POST /leads/:id/notes`
   - `PATCH /leads/:id/deal-value`

This sequence gives you the biggest improvement in production readiness with minimal risk.

---

## 9) Quick Reference: Critical Config

- Backend env:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `DSP_DB_HOST`
  - `DSP_DB_PORT`
  - `DSP_DB_NAME`
  - `DSP_DB_USER`
  - `DSP_DB_PASSWORD`

- DSP MySQL access must allow the Docker client host, not only localhost.

