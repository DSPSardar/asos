# ASOS × DSP AI Agent Mastery — integration spec

**Status:** implemented on branch `feat/mastery-integration` (Aug 2026). Owner: Sardar Ghaffar.
**Scope:** DSP tenant only (`MASTERY_TENANT_ID`). No behaviour change for any other tenant.

## 1. Business requirements

### 1.1 Product definition (what the Closer sells)
| | 7-Day Live Bootcamp | **AI Agent Mastery (self-paced)** |
|---|---|---|
| Format | Live Zoom, new batch every Monday | Recorded, 15 modules, own pace |
| Price | PKR 10,000 | **PKR 28,000 / $100 one-time** |
| Access | Cohort | **Lifetime + all future updates** |
| Support | During cohort | **12 months free in the DSP WhatsApp group** |
| Certificate | 4 (3 Anthropic + 1 DSP) | DSP Master certificate (verifiable URL) on capstone approval |
| Where | Zoom | digitalservicesprogram.com/app |
| Buy | WhatsApp → payment proof | digitalservicesprogram.com/mastery/enrol **or** WhatsApp → payment proof |

Positioning rule for the Closer: **live bootcamp for people who can attend 9 pm PKT; Mastery for people who can't** (overseas, working hours, want recordings). Never pitch both at once; qualify first.

### 1.2 Qualification (Qualifier `product` field)
- `MASTERY` — can't attend live / wants recordings / lifetime / overseas / mentions $100 or 28,000
- `BOOTCAMP` — batch dates / live timing / 10,000
- `UNKNOWN` — until the lead states a preference. Never downgraded once set (same rule as `businessUnit`).

### 1.3 Payment & enrolment
- Won means **paid**, exactly as today: CLOSED_WON requires a fee on every path.
- **Email is mandatory for Mastery** — the course account is keyed on it. The Closer must collect it before or with the payment proof. No email → lead still marked won, but an ⚠️ activity flags it and enrolment waits.
- Two enrolment routes into one account system:
  1. WhatsApp → payment proof → agent/admin confirms → **ASOS calls the course enrol API**.
  2. Course site → PKR page → screenshot → admin approves on `/app/admin` → **course calls ASOS `enrolled` event** so the sale appears in Leads/Reports.
- Either route ends the same: Supabase account active, sign-in email sent, 12-month support clock started, CRM shows a CLOSED_WON MASTERY lead with the fee.

### 1.4 Support & lifecycle
- Support = DSP WhatsApp group, 12 months from enrolment, group not 1:1. Automations nudge over WhatsApp only.
- Milestones: enrolled (+5 min, +3 days), 4 badges, capstone submitted, certificate issued, 7 days inactive. All seeded **paused**; enable per rule on `/automations`.
- Refunds: 7 days, handled by admin; lead → CLOSED_LOST reason `refund`, course profile → `refunded` (manual, both sides).

### 1.5 Reporting
- `Lead.product` enables revenue-by-product on DSP Reports. Existing KPIs unchanged; Mastery revenue is additive.

## 2. Technical design

### 2.1 Schema
`Lead.product TEXT NULL` + index `(tenant_id, product)`. Migration `20260827090000_add_lead_product` (additive, safe on prod).

### 2.2 Qualifier / Closer (`services/claude.service.js`)
- Qualifier schema gains `product` with rules; enum-guarded on parse; returned as `product`.
- Worker persists `lead.product` with never-downgrade semantics.
- Closer prompt gains "Offer the lead is on" and a routing fallback.
- **Facts come from PRODUCT CONTEXT only** — see `docs/MASTERY-PRODUCT-CONTEXT.txt`.

### 2.3 ASOS → course (`services/mastery.service.js`)
`enrolIfMasteryAsync({ tenantId, leadId, userId })` runs after both CLOSED_WON paths (`leads.service.updateStage`, `conversations.service.confirmPayment`).
POST `MASTERY_ENROL_URL` with `x-mastery-secret: MASTERY_ENROL_SECRET`, body `{ email, full_name, phone, source:'asos', asos_lead_id, fee, currency }`. Success / failure / missing-email each write a SYSTEM activity. Never blocks or rolls back the sale.

### 2.4 Course → ASOS (`webhooks/mastery.webhook.js`)
`POST /webhooks/mastery` (raw body, `x-mastery-secret: MASTERY_EVENTS_SECRET`), tenant fixed to `MASTERY_TENANT_ID`. Body `{ event, email, data }`:
- `enrolled` — upsert contact (by email, then phone) + CLOSED_WON MASTERY lead with fee; stage history + activity. Idempotent.
- `module_complete | badge_earned | capstone_submitted | capstone_approved | inactive` — SYSTEM activity with `metadata.masteryEvent` (+ `module` / `badge` / `days`).

### 2.5 Automations (`services/automation.service.js`)
New trigger `{ type:'mastery_event', event, badge?, module?, delay, unit }`. Matches SYSTEM activities by `metadata.masteryEvent` within the lookback; **does not require an AI-enabled conversation**. One send per rule per lead; 24h-window/template rules unchanged. Nine `Mastery:` rules are seeded paused for the DSP tenant on first visit to `/automations`.

### 2.6 Environment (Railway → `asos` and `asos-worker`)
```
MASTERY_ENROL_URL=https://digitalservicesprogram.com/api/mastery/enrol
MASTERY_ENROL_SECRET=<same value as the course's MASTERY_ENROL_SECRET>
MASTERY_EVENTS_SECRET=<new shared secret; same value on Vercel as ASOS_EVENTS_SECRET>
MASTERY_TENANT_ID=<DSP tenant uuid>
```
All optional: when unset the integration no-ops with a warning.

### 2.7 Course side (dsp-bootcamp-site)
- `src/lib/mastery/asos.ts` — `postAsosEvent(event, email, data)` (fire-and-forget; needs `ASOS_EVENTS_URL` + `ASOS_EVENTS_SECRET`).
- Emits: `enrolled` on PKR approval, `badge_earned` when a phase completes, `capstone_submitted`, `capstone_approved`.

## 3. Rollout
1. Merge → Railway migrates + deploys `asos` and `asos-worker`.
2. Set the four env vars on both services; redeploy.
3. Paste the PRODUCT CONTEXT block into Settings → AI; test with "recorded course chahiye, live nahi aa sakta".
4. Confirm a test payment on a MASTERY lead → check the activity and the student's inbox.
5. Enable Mastery automations one by one on `/automations`.

## 4. Verification (no test suite — manual)
- `node --check` on every touched file; `prisma validate` passes.
- Non-Mastery tenants: `ensureMasteryRules` returns immediately; `enrolIfMastery` returns `not_mastery`; webhook returns 503 unless configured.
