# ASOS v1.5 — Feature Implementation Log

This document records every feature built in the current development sprint, the exact files changed, and the rationale for each change.

---

## 1. Content Studio — Ad Variant Generation Fix

**Problem:** The `generate` endpoint returned a 500 error. The root cause was assistant message prefill (`{ role: 'assistant', content: '{' }`) being sent to `claude-sonnet-4-6`, which does not support prefill.

**Fix:** Removed prefill messages from `callClaudeForObject` and `callClaudeForArray`. Replaced with strong end-of-prompt JSON instructions (`JSON_OBJECT_INSTRUCTION` / `JSON_ARRAY_INSTRUCTION`) appended to user content.

**Files changed:**
- `backend/src/modules/content-studio/content-studio.service.js`

---

## 2. Content Studio — Page Reload on Button Click

**Problem:** Clicking Generate or Save caused the page to reload (native browser form submission). All `<button>` elements inside the page were defaulting to `type="submit"`.

**Fix:** Added `type="button"` to every `<button>` in `AdsPerformance.jsx`.

**Files changed:**
- `vite-app/src/pages/AdsPerformance.jsx`

---

## 3. Content Studio — Swipe UI & 3-Variant Generation

**Problem:** Generated variants were not displayed in the swipe studio. The response path was wrong, and generate count was 10 (too slow).

**Fix:**
- Fixed response parsing: `res?.data?.drafts ?? res?.drafts ?? []`
- Changed variant count from 10 → 3
- Rewrote swipe area to properly show variants with navigation controls
- Added save/skip buttons in the swipe studio

**Files changed:**
- `vite-app/src/pages/AdsPerformance.jsx`

---

## 4. Content Studio — Image Generation per Variant

**Problem:** No image generation existed. Variants had no visuals.

**Solution:** Two-path image generation:
1. **Replicate (paid):** Uses the Models API (`/v1/models/{owner}/{model}/predictions`) with async polling (max 60 s, 3 s intervals). Model: `black-forest-labs/flux-schnell`.
2. **Pollinations.ai (free fallback):** URL-based generation at `https://image.pollinations.ai/prompt/…`.

Both paths download image bytes with `axios.get(..., {responseType:'arraybuffer'})` and persist them to disk at `/app/uploads/content-images/{uuid}.{ext}`. The DB stores the local path — not the external URL — so images survive Pollinations.ai transience.

**Files changed:**
- `backend/src/modules/content-studio/content-studio.service.js` — added `downloadAndSave()`, `generateImage()`, `generateDraftImage()`
- `backend/src/modules/content-studio/content-studio.controller.js` — added `draftImage` handler
- `backend/src/modules/content-studio/content-studio.routes.js` — added `POST /drafts/:id/image`
- `backend/src/app.js` — added `express.static('/uploads')` for dev
- `vite-app/vite.config.js` — added `/uploads` proxy to backend (dev)
- `vite-app/src/lib/api.js` — added `contentStudioAPI.draftImage()`
- `vite-app/src/pages/AdsPerformance.jsx` — added Generate Image button, image display with fade-in

---

## 5. Image Persistence via Docker Volume

**Problem:** Images disappeared between deployments because they were written inside the container.

**Fix:** Added a named Docker volume `uploads_data` shared between the `api` container (write path `/app/uploads`) and the `nginx` container (read path `/var/www/uploads`). Nginx serves `/uploads/` directly on the frontend domain (`app.getaisales.com`), making `<img src="/uploads/...">` load same-origin with no CORS issues.

**Files changed:**
- `docker-compose.yml` — added `uploads_data` volume to `api` and `nginx` services
- `nginx/nginx.conf` — added `/uploads/` location block on the frontend vhost

---

## 6. Organic Lead Capture on Signup

**Feature:** When a user registers (email/password or Google OAuth), their phone number is captured and stored as a CRM lead tagged `organic`. The lead appears in the Pipeline and Leads views with source label "Organic".

**Implementation details:**
- `createOrganicLead(tx, {tenantId, name, email, phone})` — upserts `Contact` with `tags:['organic']`, creates `Lead` with `sourceUtm:{source:'organic_signup'}`. Idempotent via `prisma.contact.upsert` on `{tenantId, phone}`.
- `register()` accepts optional `phone` param; calls `createOrganicLead` inside the transaction if provided.
- `googleAuth()` sets `isNewUser = true` for brand-new Google signups and returns the flag to the frontend.
- `saveOrganicPhone({userId, tenantId, phone})` — called post-OAuth when the user submits the phone modal. Validates E.164 format, runs inside a transaction.
- **Frontend:** After Google login, if `isNewUser === true`, shows a WhatsApp phone capture modal (green design, "Save & Continue" / "Skip for now"). Email/password register form has an optional WhatsApp field.
- **Pipeline:** Source column recognises `organic` tag / `sourceUtm.source === 'organic_signup'` and shows teal "Organic" badge. Filterable via the Sources dropdown.

**Files changed:**
- `backend/src/modules/auth/auth.service.js` — `createOrganicLead`, updated `register`, updated `googleAuth`, added `saveOrganicPhone`
- `backend/src/modules/auth/auth.controller.js` — optional `phone` in `registerSchema`, added `savePhone` handler
- `backend/src/modules/auth/auth.routes.js` — added `POST /auth/phone` (authenticated)
- `vite-app/src/lib/api.js` — added `authAPI.savePhone()`
- `vite-app/src/pages/Auth.jsx` — phone modal after Google OAuth, optional WhatsApp field in register form
- `vite-app/src/pages/Pipeline.jsx` — Organic source badge + filter

---

## 7. Dynamic WhatsApp Settings (DB-backed)

**Feature:** The WhatsApp settings tab now reads from and writes to the database instead of showing hardcoded values.

**Implementation details:**
- Loads `waPhoneId`, tenant name, and connection status from `settingsAPI.get()` on mount.
- Save button calls `settingsAPI.updateWA({waPhoneId, waAccessToken, waAppSecret, waVerifyToken})` — sensitive tokens are AES-256-GCM encrypted at the service layer before storage.
- Access token and app secret fields use `type="password"` and show a placeholder "paste to update" — blank means "keep existing". Tokens are cleared from state after save.
- Test message button calls `settingsAPI.testWA(phone)` — a real WhatsApp API call via `whatsappService.sendText()`.
- Webhook URL is computed from `VITE_API_URL` + tenant ID (not hardcoded), with a one-click Copy button.
- Connection status indicator is live (green dot with pulse if `waPhoneId` is set, grey if not).

**Files changed:**
- `vite-app/src/pages/Settings.jsx` — rewrote `WhatsAppTab` with live API calls

**Backend routes already existed:**
- `GET /api/v1/settings` → `settingsAPI.get()`
- `PUT /api/v1/settings/whatsapp` → `settingsAPI.updateWA()`
- `POST /api/v1/settings/whatsapp/test` → `settingsAPI.testWA()`

---

## 8. Dynamic AI Configuration Settings (DB-backed)

**Feature:** The AI Configuration tab now reads from and writes to the database. New fields (`tone`, `closerModel`, `monthlyBudget`, `handoffRules`) were added to the `AiConfig` model.

**Schema migration required — run after deploying:**
```bash
cd backend
npx prisma migrate dev --name add_ai_config_ui_fields
```

**New `AiConfig` fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `tone` | `String` | `"Professional"` | AI response tone |
| `closerModel` | `String?` | null | Override Closer agent model |
| `monthlyBudget` | `Decimal?` | null | Monthly AI spend cap (USD) |
| `handoffRules` | `Json` | `{}` | Toggle states: `{payment, unanswered, legal, hotProposal}` |

**Implementation details:**
- `AITab` loads config via `aiConfigAPI.get()` and live token usage via `aiConfigAPI.usage()` on mount.
- Save button calls `aiConfigAPI.update({model, systemPrompt, tone, language, monthlyBudget, handoffRules})`.
- Usage bar shows estimated USD spend computed from `aiTokensUsed × $0.000003` (blended rate).
- Handoff rules are stored as a JSON blob in `handoffRules` — separate from the existing `handoffTriggers` array used by the AI worker (no worker changes required).
- All model options updated to current Claude API strings (`claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`).

**Files changed:**
- `backend/prisma/schema.prisma` — added `tone`, `closerModel`, `monthlyBudget`, `handoffRules` to `AiConfig`
- `backend/src/modules/ai-config/aiConfig.service.js` — added new fields to `allowed` list in `updateConfig`
- `vite-app/src/pages/Settings.jsx` — rewrote `AITab` with live API calls, removed `DEFAULT_AI_PROMPT` hardcoded default (now loaded from DB)

---

## Deployment Checklist

After pulling this code to the server:

```bash
# 1. Run Prisma migration (adds 4 new AiConfig columns)
cd /opt/asos
docker compose exec api npx prisma migrate deploy

# 2. Rebuild and restart
./deploy/update.sh
```

The migration is non-destructive — all new columns have defaults and are nullable where appropriate. No data loss on existing tenants.

---

## Environment Variables (no new ones required)

All features use existing env vars. Image generation uses:
- `REPLICATE_API_TOKEN` — optional; falls back to Pollinations.ai if not set
- `REPLICATE_MODEL` — optional; defaults to `black-forest-labs/flux-schnell`
