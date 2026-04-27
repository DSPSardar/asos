# ASOS v1 — Backend API

AI Sales Operating System — Production-ready multi-tenant Node.js + PostgreSQL backend.

## Tech Stack

- **Runtime**: Node.js 22 LTS
- **Framework**: Express.js 5
- **Database**: PostgreSQL 16 + Prisma ORM
- **Cache / Queue**: Redis 7 + BullMQ
- **AI Engine**: Anthropic Claude (claude-3-5-sonnet)
- **WhatsApp**: Meta WhatsApp Cloud API
- **Meta Ads**: Conversions API (CAPI)
- **Auth**: JWT + Refresh Tokens + bcrypt
- **Validation**: Zod
- **Logging**: Pino

---

## Quick Start

### 1. Clone & install

```bash
cd backend
npm install
```

### 2. Environment

```bash
cp .env.example .env
# Fill in all required values
```

### 3. Database setup

```bash
# Run migrations
npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate

# Seed demo data
node prisma/seed.js
```

### 4. Start servers

```bash
# Terminal 1 — API server
npm run dev

# Terminal 2 — Conversation worker (BullMQ)
npm run worker
```

---

## Architecture Overview

```
Internet
    │
    ▼
[API Gateway / Nginx]
    │
    ├── POST /webhooks/whatsapp  ──► Webhook Worker ──► BullMQ Queue
    │                                                        │
    │                                              Conversation Worker
    │                                              ┌─────────────────┐
    │                                              │ 1. Resolve CRM  │
    │                                              │ 2. Claude AI    │
    │                                              │ 3. Send WA msg  │
    │                                              │ 4. Meta CAPI    │
    │                                              └─────────────────┘
    │
    └── /api/v1/*  ──► Express Router ──► Module Controllers ──► Prisma ──► PostgreSQL
```

---

## API Endpoints

All endpoints are prefixed with `/api/v1`.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | /auth/register | Register new tenant + admin | Public |
| POST | /auth/login | Login → returns JWT | Public |
| POST | /auth/refresh | Refresh access token | Public |
| POST | /auth/logout | Revoke refresh token | JWT |
| GET | /auth/me | Get current user | JWT |
| GET | /leads | List leads (filterable) | Agent+ |
| GET | /leads/pipeline | Kanban pipeline data | Agent+ |
| GET | /leads/:id | Lead detail + history | Agent+ |
| POST | /leads | Create lead | Agent+ |
| PATCH | /leads/:id/stage | Update pipeline stage | Agent+ |
| PATCH | /leads/:id/assign | Assign to agent | Admin |
| POST | /leads/:id/notes | Add activity note | Agent+ |
| GET | /contacts | List contacts | Agent+ |
| POST | /contacts | Create contact | Agent+ |
| GET | /conversations | Inbox list | Agent+ |
| GET | /conversations/:id | Full conversation + messages | Agent+ |
| POST | /conversations/:id/messages | Send message | Agent+ |
| PATCH | /conversations/:id/ai | Toggle AI on/off | Agent+ |
| POST | /conversations/:id/takeover | Human takes over | Agent+ |
| GET | /conversations/:id/summary | AI summary | Agent+ |
| GET | /campaigns | List campaigns | Admin |
| POST | /campaigns/:id/sync | Sync Meta Ads data | Admin |
| GET | /campaigns/:id/roi | ROI report | Admin |
| GET | /analytics/overview | Dashboard KPIs | Admin |
| GET | /analytics/funnel | Conversion funnel | Admin |
| GET | /analytics/ai-performance | AI metrics | Admin |
| GET | /ai/config | Get AI prompt config | Admin |
| PUT | /ai/config | Update Claude config | Admin |
| POST | /ai/config/test | Sandbox test | Admin |
| GET | /settings | Tenant settings | Admin |
| PUT | /settings/whatsapp | Update WA credentials | Admin |
| GET | /billing/subscription | Usage + limits | Admin |
| GET | /admin/tenants | All tenants (superadmin) | Superadmin |
| GET | /admin/metrics | Platform KPIs | Superadmin |

---

## Webhook Setup

### WhatsApp Cloud API

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create a Meta App → WhatsApp product
3. Set webhook URL: `https://yourdomain.com/webhooks/whatsapp`
4. Set verify token to match `WHATSAPP_VERIFY_TOKEN` in `.env`
5. Subscribe to: `messages`, `message_status_updates`

---

## Multi-tenancy

- All tables include `tenant_id` foreign key
- Tenant resolved from JWT claim on every request
- `requireActiveTenant` middleware blocks suspended/cancelled tenants
- WhatsApp credentials stored per-tenant (encrypted with AES-256-GCM)
- Each tenant has independent AI config, pipeline, campaigns

---

## Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma          # Full DB schema
│   └── seed.js                # Demo data seeder
├── src/
│   ├── config/                # env, database, redis
│   ├── middleware/             # auth, tenant, error, validate
│   ├── modules/
│   │   ├── auth/              # JWT auth + registration
│   │   ├── leads/             # CRM lead management
│   │   ├── contacts/          # Contact CRUD
│   │   ├── conversations/     # WA conversation handling
│   │   ├── campaigns/         # Meta Ads campaigns
│   │   ├── analytics/         # Dashboard data
│   │   ├── users/             # Team management
│   │   ├── settings/          # Tenant config
│   │   ├── ai-config/         # Claude configuration
│   │   ├── billing/           # Stripe subscriptions
│   │   └── admin/             # Superadmin panel
│   ├── services/
│   │   ├── claude.service.js  # AI Engine (core)
│   │   ├── whatsapp.service.js# WA Cloud API client
│   │   └── meta.service.js    # Meta Conversions API
│   ├── queues/                # BullMQ queue definitions
│   ├── workers/               # BullMQ job processors
│   ├── webhooks/              # WA + Stripe webhooks
│   ├── utils/                 # logger, response, crypto
│   ├── app.js                 # Express factory
│   └── server.js              # HTTP server entry
├── .env.example
└── package.json
```

---

## Demo Credentials (after seed)

| Role | Email | Password |
|------|-------|----------|
| Superadmin | superadmin@asos.io | superadmin123! |
| Tenant Admin | admin@demo-empresa.com | admin123! |
| Agent | agent@demo-empresa.com | agent123! |

---

## Claude AI Response Schema

Every AI response returns structured JSON:

```json
{
  "reply": "WhatsApp message to send",
  "leadStatus": "HOT | WARM | COLD",
  "score": 8,
  "stage": "QUALIFYING",
  "problemDiagnosis": "Lead's core problem",
  "salesFix": "How our product solves it",
  "urgencyTrigger": "Limited spots available this month",
  "action": "continue | handoff | close",
  "handoffReason": null,
  "qualificationData": {
    "budget": "R$ 5.000",
    "authority": "Decisor",
    "need": "Aumentar conversões",
    "timeline": "Próximo mês"
  }
}
```

---

*ASOS v1 Backend — Built for production multi-tenant SaaS*
