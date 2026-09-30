# AI-Token Billing: "Never Silently Dark" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenant's AI can no longer go quiet because of an old token counter. Usage resets monthly, internal tenants are exempt from the cap, owners are warned at 80%/95%, and threads the cap paused come back to the AI automatically. Tokens per reply go down on long threads.

**Architecture:** One new service (`usageCycle.service.js`) owns period rollover, threshold alerts and cap-hold release. It runs as a 5-minute BullMQ repeatable on the existing scheduler queue and is also called inline from the worker. A shared `conversationContext` loader replaces the worker's full-history query with a bounded window plus a cached rolling summary on the Lead. Prompt caching gets a stable `prompt_cache_key`, and cached-token counts are logged so the before/after comparison can be measured.

**Tech Stack:** Node 22, Prisma 5 / Postgres (RLS), BullMQ 5, ioredis, OpenAI SDK v6 (chat.completions), `node:test` + `test/_fakePrisma.js`.

**Spec:** The user's request in this session (items 1–5). Deploy is gated on explicit user approval.

## Global Constraints

- RLS: every cross-tenant scan goes through `runWithSystemScope`, and every per-tenant write happens inside `requestContext.run({ tenantId }, …)`. Every Prisma `where` includes `tenantId`.
- The DSP tenant id is `87bfa1b0-1774-4278-b630-d30836cf4183`. `tenant.settings.billingExempt === true` counts usage but never enforces the cap.
- Alerts go out once per tenant, per period, per threshold, using Redis `SET … NX`.
- New env vars go through `config/env.js`. No ad-hoc `process.env` reads.
- The worker's `waMessageId` dedup stays intact. Re-queues use the real `waMessageId` with `replay: true`, the same way `conversations.service.js` `handback` does.
- Bank or payment details never reach the LLM. That includes the summarizer: `sanitizeHistoryForAI` runs before summarizing.
- `deriveStage` monotonicity and the Closer's `messageCount` phase logic (lead-message count) must not change behavior.
- Branch `fix/ai-token-billing`. No push to `main`, no deploy, and no prod writes until the user approves.
- Tests: `cd backend && npm test`. **Baseline:** two suites already fail on `main` before this work (`rls-isolation`, `tenant-isolation`, which need a live Postgres). Everything else passes.

## Findings that change the brief (read before approving)

1. **History already doesn't grow unboundedly in the prompt.** The worker loads the full history from the DB, but `claude.service.js` sends only the last **15** messages to the Qualifier (L216), the last **20** to the Closer (L523) and the last **10** to Support (L618). "Last ~40 verbatim + summary" would therefore *raise* tokens per reply on long threads. Most of the per-reply cost is the system prompt and PRODUCT CONTEXT, sent twice (Qualifier and Closer). → **Decision D1.**
2. **Prompt ordering for caching already exists.** Static content comes first and per-lead lines come last (comment at L180). OpenAI caches automatically for prefixes of 1024+ tokens. The billing counter, however, adds `usage.total_tokens`, which counts cached tokens at full weight. Caching lowers the OpenAI bill but **does nothing for the cap** unless metering changes. → **Decision D3.**
3. **`currentPeriodEnd` already means "paid through" for manual-payment tenants.** `manualPayment.service.js approve()` stacks N months onto it. Rolling it forward by a month on expiry would make the billing page show paid-through dates nobody paid for. Stripe tenants are already reset by the `invoice.payment_succeeded` webhook. → **Decision D2.**
4. **The backlog sweep bypasses the cap.** `backlogSweep.service.js` L129 re-enables AI on human-held threads after 2 h and calls the AI directly, without `checkPlanLimits`. Today it would quietly un-pause "AI token limit reached" threads and spend past the cap. Fixed in Task 5.
5. **Privilege escalation to guard against.** If the settings PATCH merges arbitrary keys into `tenant.settings`, a tenant admin could set `billingExempt: true` on their own account. Task 2 pins that only SUPERADMIN (or the migration) can set it.

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/services/usageCycle.service.js` (new) | Pure helpers `rollPeriod`, `crossedThresholds`, `isBillingExempt`. Plus `runUsageTick()` (reset, then release), `maybeAlertUsage(tenant)`, `releaseTokenLimitHolds(tenant)` |
| `backend/src/config/constants.js` | `TOKEN_LIMIT_HANDOFF_REASON` (single source; the worker and sweep both match on it) |
| `backend/src/modules/billing/billing.service.js` | `checkPlanLimits` honours `billingExempt` |
| `backend/src/queues/message.queue.js` | `registerUsageTick()` (every 5 min) |
| `backend/src/workers/conversation.worker.js` | Scheduler handler `usage-tick`. Post-reply `maybeAlertUsage`. Uses the `conversationContext` loader |
| `backend/src/services/dailyDigest.service.js` | Usage line in `buildDigest` / `renderText` / `renderWhatsAppText` |
| `backend/src/services/backlogSweep.service.js` | Skip cap-held threads and capped tenants |
| `backend/src/modules/settings/settings.service.js` | Strip `billingExempt` from tenant-admin writes |
| `backend/src/utils/conversationContext.js` (new) | `loadConversationContext()` returns a bounded window, the lead-message count and the earlier summary. `refreshSummaryIfDue()` |
| `backend/src/services/claude.service.js` | `prompt_cache_key`, cached-token capture, summary injected into history, metering (D3), `generateSummary({ priorSummary })` |
| `backend/prisma/schema.prisma` + migration `20261001000000_usage_cycle_and_history_summary` | New columns (Lead summary, AiAgentLog cached tokens, and optionally usage-period columns from D2), the period backfill, the DSP `billingExempt` flag |
| `backend/scripts/token-burn-report.js` (new) | Before/after tokens-per-reply on the 3 longest DSP threads. Read-only |
| `backend/test/usage-cycle.test.js`, `billing-exempt.test.js`, `usage-alerts.test.js`, `token-limit-release.test.js`, `conversation-context.test.js`, `prompt-caching.test.js` (new) | One suite per item |

## Decisions needed (my recommendation first)

- **D1 History window.** (a) **Recommended:** keep 15/20 verbatim and add a rolling summary of everything older. Quality improves, because today anything past message 20 is simply forgotten, and tokens stay roughly flat (+~150 tokens for the summary). (b) Literal brief: 40 verbatim plus summary. Tokens per reply go **up** on long threads. (c) Trim to 10/12 plus summary. Tokens per reply go down, with a small risk to recall.
- **D2 Usage period anchor.** (a) **Recommended:** new `usage_period_start/end` columns that the monthly reset owns. `currentPeriod*` keeps meaning "Stripe/manual paid-through". (b) Literal brief: reuse `current_period_start/end` for tenants with no `stripeSubId`. Simpler, but it corrupts the paid-through date for manual-payment tenants.
- **D3 Metering.** (a) **Recommended:** metered tokens = uncached input + ⌈0.1 × cached input⌉ + output, which tracks what OpenAI actually charges, so caching shrinks the cap burn. (b) Keep `total_tokens`: caching saves money but not cap headroom.
- **D4 Measurement access.** The report needs read-only access to prod Postgres (via the Railway `DATABASE_URL`) for the 3 longest DSP threads and their `AiAgentLog` rows. For "after" I would replay the last 5 turns of each thread through the new prompt builder: offline token counts (no API spend) plus 3 real calls per thread to observe `cached_tokens` (a few cents, **no** WhatsApp sends, **no** DB writes). Raw message content stays in the scratchpad, and only aggregates get reported.

**Decided 2026-09-30:** D1 (a) keep 15/20 + summary · D2 (a) new `usage_period_*` columns · D3 (a) discount cached input · D4 (a) prod DB read + 3 live calls/thread. The tasks below implement exactly these choices.

## Review Focus

1. **A period missed by several months** (the worker was down, or DSP has been NULL since launch). The rollover must jump straight to the period containing `now`, reset once, and not loop or reset repeatedly. Pinned in Task 1.
2. **Month-end anchors.** A Jan 31 start must roll to Feb 28/29, then Mar 31, not drift to the 28th forever. Pinned in Task 1.
3. **Two workers or a retried job running the reset concurrently.** The conditional `updateMany where usagePeriodEnd = <old>` must make the second run a no-op. Pinned in Task 1.
4. **Crossing 80% and 95% in a single reply**, for example on one huge summary call. Both alerts fire once, and the next reply sends none. Pinned in Task 3.
5. **A released thread whose last inbound was already answered, or which a human took over after the cap.** It must not get a duplicate reply, and human takeovers (a different `handoffReason`) must never be released. Pinned in Task 4.

---

### Task 0: Branch + baseline measurement (read-only)

**Files:** Create `backend/scripts/token-burn-report.js`

- [ ] **Step 1:** `git checkout -b fix/ai-token-billing`
- [ ] **Step 2:** Write the report script. It runs under `runWithSystemScope`, then `requestContext.run({ tenantId: DSP })`, and:
  - picks the 3 conversations for DSP with the most `message` rows;
  - for each, pulls its `AiAgentLog` rows and prints `n replies`, mean/median `qualifierTokens`, `closerTokens`, `(q+c)` per reply, and mean `(q+c)` for the last 20 replies;
  - `--replay` mode (Task 6): rebuilds the last 5 turns' prompts with the old and new context loaders and counts input tokens with `o200k_base` (`js-tiktoken`, dev dependency only). `--live` also makes 3 real Closer calls per thread and prints `usage.prompt_tokens_details.cached_tokens`.
- [ ] **Step 3 (needs D4 approval):** Run it against prod with `DATABASE_URL` supplied in the environment for this command only. Save the output to the scratchpad and paste the aggregate table into the PR description as **Before**.

### Task 1: Monthly usage reset + backfill

**Files:** Create `src/services/usageCycle.service.js`. Modify `prisma/schema.prisma` (Subscription: `usagePeriodStart DateTime? @map("usage_period_start")`, `usagePeriodEnd DateTime? @map("usage_period_end")`), `src/queues/message.queue.js`, `src/workers/conversation.worker.js` (scheduler switch). Migration `20261001000000_usage_cycle_and_history_summary`. Test `test/usage-cycle.test.js`.

**Produces:** `rollPeriod({ start, end, now }) → { start, end, rolled: boolean }` and `runUsageTick({ now? }) → { reset: string[], released: Record<tenantId, number> }`.

- [ ] **Step 1: Failing tests**

```js
// test/usage-cycle.test.js
const { rollPeriod } = require('../src/services/usageCycle.service');
const d = (s) => new Date(s);

test('period not yet over → unchanged', () => {
  const r = rollPeriod({ start: d('2026-09-15T00:00Z'), end: d('2026-10-15T00:00Z'), now: d('2026-09-30T00:00Z') });
  assert.equal(r.rolled, false);
});
test('several missed months jump straight to the period containing now', () => {
  const r = rollPeriod({ start: d('2026-03-15T00:00Z'), end: d('2026-04-15T00:00Z'), now: d('2026-09-30T00:00Z') });
  assert.deepEqual([r.start, r.end, r.rolled], [d('2026-09-15T00:00Z'), d('2026-10-15T00:00Z'), true]);
});
test('month-end anchor clamps without drifting', () => {
  const a = rollPeriod({ start: d('2026-01-31T00:00Z'), end: d('2026-02-28T00:00Z'), now: d('2026-03-01T00:00Z') });
  assert.deepEqual([a.start, a.end], [d('2026-02-28T00:00Z'), d('2026-03-31T00:00Z')]);
});
test('runUsageTick resets expired, non-Stripe subscriptions exactly once', async () => {
  db.subscription.push({ id: 's1', tenantId: 't1', stripeSubId: null, aiTokensUsed: 900n, aiTokensLimit: 1000n, messagesUsed: 50,
    usagePeriodStart: d('2026-08-15T00:00Z'), usagePeriodEnd: d('2026-09-15T00:00Z') });
  db.subscription.push({ id: 's2', tenantId: 't2', stripeSubId: 'sub_x', aiTokensUsed: 900n, usagePeriodEnd: d('2026-09-01T00:00Z') });
  const now = d('2026-09-30T00:00Z');
  const [a, b] = await Promise.all([usage.runUsageTick({ now }), usage.runUsageTick({ now })]);
  assert.deepEqual([...a.reset, ...b.reset], ['t1']);               // concurrent run is a no-op
  assert.equal(db.subscription.find((s) => s.id === 's1').aiTokensUsed, 0n);
  assert.equal(db.subscription.find((s) => s.id === 's2').aiTokensUsed, 900n); // Stripe owns its cycle
});
```

- [ ] **Step 2:** Run `node --test test/usage-cycle.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** The anchor day is `max(start.day, end.day)`. A clamped period (for example Feb 28 → Mar 31) still carries the true anchor in whichever end wasn't clamped, so it never drifts. Each roll adds whole months and clamps to the month's length.

```js
const addMonthsClamped = (base, k, anchorDay) => {
  const y = base.getUTCFullYear(), m = base.getUTCMonth() + k;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, dim), base.getUTCHours(), base.getUTCMinutes()));
};
const rollPeriod = ({ start, end, now }) => {
  if (end > now) return { start, end, rolled: false };
  const anchorDay = Math.max(start.getUTCDate(), end.getUTCDate());
  let k = 1;
  while (addMonthsClamped(start, k + 1, anchorDay) <= now) k++;
  return { start: addMonthsClamped(start, k, anchorDay), end: addMonthsClamped(start, k + 1, anchorDay), rolled: true };
};

const runUsageTick = ({ now = new Date() } = {}) => runWithSystemScope(async () => {
  const due = await prisma.subscription.findMany({
    where: { stripeSubId: null, usagePeriodEnd: { lte: now } },
    select: { tenantId: true, usagePeriodStart: true, usagePeriodEnd: true },
  });
  const reset = [];
  for (const s of due) {
    await requestContext.run({ tenantId: s.tenantId }, async () => {
      const next = rollPeriod({ start: s.usagePeriodStart, end: s.usagePeriodEnd, now });
      const { count } = await prisma.subscription.updateMany({
        where: { tenantId: s.tenantId, usagePeriodEnd: s.usagePeriodEnd },   // optimistic guard
        data: { aiTokensUsed: 0n, messagesUsed: 0, usagePeriodStart: next.start, usagePeriodEnd: next.end },
      });
      if (count) { reset.push(s.tenantId); logger.info({ tenantId: s.tenantId, next }, '🔄 Usage period rolled — counters reset'); }
    });
  }
  const released = await releaseAllEligibleHolds(); // Task 4
  return { reset, released };
});
```

The Stripe `invoice.payment_succeeded` handler also sets `usagePeriodStart/End` from the invoice period, so Stripe tenants appear on the billing page with the same fields.

- [ ] **Step 4: Migration + backfill SQL.** Write it with `npx prisma migrate dev --create-only --name usage_cycle_and_history_summary`, then append the data section below the generated DDL:

```sql
-- Backfill: anchor every subscription on its created_at day-of-month; the current
-- period is the one containing now().
UPDATE subscriptions s SET
  usage_period_start = p.start, usage_period_end = p.start + interval '1 month'
FROM (
  SELECT id, created_at + (date_part('year', age(now(), created_at)) * 12
                          + date_part('month', age(now(), created_at))) * interval '1 month' AS start
  FROM subscriptions
) p WHERE p.id = s.id AND s.usage_period_start IS NULL;

-- DSP has accumulated since launch: recount this period from the audit log.
UPDATE subscriptions s SET ai_tokens_used = COALESCE((
  SELECT SUM(l.qualifier_tokens + l.closer_tokens) FROM ai_agent_logs l
  WHERE l.tenant_id = s.tenant_id AND l.created_at >= s.usage_period_start), 0)
WHERE s.stripe_sub_id IS NULL;

UPDATE tenants SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{billingExempt}', 'true')
WHERE id = '87bfa1b0-1774-4278-b630-d30836cf4183';
```

  First, check `20260811120000_enable_row_level_security` for `FORCE ROW LEVEL SECURITY` on `subscriptions` / `tenants` / `ai_agent_logs`. If it is forced, the migration role needs `SET LOCAL app.rls_scope = 'system'` (use the same GUC that `config/database.js` sets) at the top of the data section. Recounting from `AiAgentLog` is a **floor**, because support-reply tokens aren't logged there. Say so in the PR.

- [ ] **Step 5:** Register `usage-tick` (`*/5 * * * *`) in `message.queue.js` with the same idempotent pattern as `registerBacklogSweep`, and add `if (job.name === 'usage-tick') return require('../services/usageCycle.service').runUsageTick();` to the scheduler switch.
- [ ] **Step 6:** `npm test`. Expected: the new suite passes, and only the two baseline failures remain.
- [ ] **Step 7:** Commit `feat(billing): monthly AI usage reset with period backfill`.

### Task 2: `billingExempt` for internal tenants

**Files:** `src/services/usageCycle.service.js` (`isBillingExempt`), `src/modules/billing/billing.service.js`, `src/workers/conversation.worker.js` (pass `tenant`), `src/modules/settings/settings.service.js`. Test `test/billing-exempt.test.js`.

**Produces:** `isBillingExempt(tenant) → boolean` and `checkPlanLimits(tenantId, resource, { tenant } = {})`.

- [ ] **Step 1: Failing tests**

```js
test('exempt tenant at 150% of limit is not blocked, usage still recorded', async () => {
  db.tenant.push({ id: 'dsp', settings: { billingExempt: true } });
  db.subscription.push({ tenantId: 'dsp', aiTokensUsed: 1500n, aiTokensLimit: 1000n });
  await assert.doesNotReject(billing.checkPlanLimits('dsp', 'ai_tokens'));
});
test('non-exempt tenant at limit → 402', async () => {
  db.tenant.push({ id: 't1', settings: {} });
  db.subscription.push({ tenantId: 't1', aiTokensUsed: 1000n, aiTokensLimit: 1000n });
  await assert.rejects(billing.checkPlanLimits('t1', 'ai_tokens'), { statusCode: 402 });
});
test('billingExempt: "true" (string) is NOT exempt — strict boolean', () => {
  assert.equal(isBillingExempt({ settings: { billingExempt: 'true' } }), false);
});
test('tenant admin cannot set billingExempt through settings', async () => {
  // call the settings update the controller uses with { billingExempt: true } as TENANT_ADMIN
  // → stored settings.billingExempt remains undefined
});
```

(Before writing the last test, read `settings.service.js` to find the exact write function and whether it merges raw keys. Pin whichever path exists.)

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** `isBillingExempt = (t) => t?.settings?.billingExempt === true`. In `checkPlanLimits`, for `ai_tokens`, load the tenant `settings` (or use `opts.tenant`) and return early when exempt. In settings writes, `delete incoming.billingExempt` unless `req.user.role === 'SUPERADMIN'`. The token increments in `claude.service.js` are unchanged, so usage is still counted.
- [ ] **Step 4:** Tests pass. Commit `feat(billing): billingExempt tenants are metered but never capped`.

### Task 3: 80% / 95% owner alerts (WhatsApp + daily digest)

**Files:** `src/services/usageCycle.service.js`, `src/workers/conversation.worker.js`, `src/services/dailyDigest.service.js`. Test `test/usage-alerts.test.js`.

**Produces:** `crossedThresholds(used, limit) → number[]` (subset of `[80, 95]`), `maybeAlertUsage(tenant, { now? }) → number[]` (thresholds actually sent) and `usageSummary(sub) → { pct, used, limit, periodEnd } | null`.

- [ ] **Step 1: Failing tests**

```js
test('crossedThresholds', () => {
  assert.deepEqual(crossedThresholds(790n, 1000n), []);
  assert.deepEqual(crossedThresholds(800n, 1000n), [80]);
  assert.deepEqual(crossedThresholds(960n, 1000n), [80, 95]);
  assert.deepEqual(crossedThresholds(5n, 0n), []);               // no limit → no alerts
});
test('one alert per threshold per period (Redis NX), both fire if crossed together', async () => {
  // fake redis + whatsappService.sendText spy; tenant.settings.adminPhone = '923001234567'
  assert.deepEqual(await usage.maybeAlertUsage(tenant), [80, 95]);
  assert.deepEqual(await usage.maybeAlertUsage(tenant), []);
  assert.equal(sent.length, 2);
});
test('new period → alerts can fire again', async () => { /* change usagePeriodStart → key differs */ });
test('exempt tenant gets no threshold alerts', async () => { /* settings.billingExempt = true → [] */ });
test('digest shows AI usage line at ≥80%, omitted below', () => {
  const d = dailyDigest.buildDigest({ ...baseSections, usage: { pct: 83, used: 830000, limit: 1000000, periodEnd } }, tenant);
  assert.match(dailyDigest.renderWhatsAppText(d), /AI usage: 83%/);
});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Redis key `asos:usage_alert:${tenantId}:${usagePeriodStart.toISOString()}:${pct}`, `SET … 'NX', 'EX', 40*86400`. Send to `settings.adminPhone` through `whatsappService.sendText(tenant, …)`, and if `adminPhone` is missing, fall back to `notificationService.notifyAdmin(tenant, 'usageThreshold', …)` for email. Message copy: `⚠️ AI usage at 95% (950k / 1M tokens) — resets ${date}. At 100% new conversations pause and go to your inbox. Upgrade: ${APP_URL}/billing`. The worker calls `maybeAlertUsage(tenant).catch(log)` after `processMessage` returns. It is non-blocking, so it can never affect the reply. The digest's `sendDailyDigest` loads the subscription and passes `usageSummary(sub)` into `buildDigest`. The line renders when `pct >= 80`, or always when the cap is reached.
- [ ] **Step 4:** Tests pass. Commit `feat(billing): 80/95% AI usage alerts via WhatsApp and daily digest`.

### Task 4: Auto-release cap-held conversations

**Files:** `src/config/constants.js` (`TOKEN_LIMIT_HANDOFF_REASON = 'AI token limit reached — plan upgrade required'`), `src/workers/conversation.worker.js` (use the constant), `src/services/usageCycle.service.js`. Test `test/token-limit-release.test.js`.

**Produces:** `releaseTokenLimitHolds(tenant) → number` and `releaseAllEligibleHolds() → Record<tenantId, number>`, called at the end of `runUsageTick`.

- [ ] **Step 1: Failing tests**

```js
test('under cap → cap-held threads released, last unanswered inbound re-queued with replay', async () => {
  // sub used 0 / limit 1000; conv c1 aiEnabled=false handoffReason=TOKEN_LIMIT_HANDOFF_REASON, last msg INBOUND waMessageId 'wamid.1'
  // conv c2 aiEnabled=false handoffReason='Lead asked for a human'
  assert.equal(await usage.releaseTokenLimitHolds(tenant), 1);
  assert.equal(conv('c1').aiEnabled, true); assert.equal(conv('c1').status, 'AI_HANDLING'); assert.equal(conv('c1').handoffReason, null);
  assert.equal(conv('c2').aiEnabled, false);                               // human handoff untouched
  assert.deepEqual(published.map((p) => [p.waMessageId, p.replay]), [['wamid.1', true]]);
  assert.equal(redisSets.filter((k) => k.startsWith('asos:ai_control:')).length, 0); // NOT a human handback
});
test('still at cap → nothing released', async () => { /* used 1000 / 1000 → 0 */ });
test('exempt tenant at cap → released', async () => { /* billingExempt true → 1 */ });
test('last message outbound → released but nothing re-queued', async () => { /* published.length === 0 */ });
test('limit raised (admin plan change) → next tick releases', async () => { /* bump aiTokensLimit, runUsageTick → released.t1 === 1 */ });
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** `releaseAllEligibleHolds` does the following:
  - Under system scope, finds `conversation.findMany({ where: { aiEnabled: false, handoffReason: TOKEN_LIMIT_HANDOFF_REASON }, distinct: ['tenantId'] })`.
  - For each tenant, inside `requestContext.run({ tenantId })`, it loads the tenant and subscription. If the tenant is exempt or `used < limit`, it runs `releaseTokenLimitHolds`.
  - That flips each conversation to `aiEnabled: true, status: 'AI_HANDLING', handoffReason: null` with an `updateMany` guarded by `handoffReason: TOKEN_LIMIT_HANDOFF_REASON`, so a human who took over in between is not overridden. It then writes an `AI_ACTION` Activity (`'AI resumed — token limit cleared'`). If the last message is an INBOUND from the CONTACT with a `waMessageId`, it `publishInboundMessage({ …, replay: true })`, and the worker's existing already-answered check handles the rest.

  The 5-minute tick satisfies "as soon as the limit is raised or the period resets" across every writer path (admin plan change, manual payment approval, Stripe activation, the reset) without hooking each one.
- [ ] **Step 4:** Tests pass. Commit `feat(billing): release token-limit handoffs back to AI when headroom returns`.

### Task 5: Backlog sweep respects the cap

**Files:** `src/services/backlogSweep.service.js`. Test: extend `test/backlog-sweep.test.js`.

- [ ] **Step 1: Failing tests.** (1) `classifyThread` on a conversation with `handoffReason === TOKEN_LIMIT_HANDOFF_REASON` returns `{ action: 'skip', reason: 'token_limit_hold' }` even after the 2 h grace. (2) `runTick` for a non-exempt tenant with `used >= limit` sends nothing and does not flip `aiEnabled`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the `token_limit_hold` guard at the top of `classifyThread`. In the per-tenant loop, `await billingService.checkPlanLimits(tenant.id, 'ai_tokens', { tenant })`, and on a 402 skip AI replies for that tenant (flagged alerts still run).
- [ ] **Step 4:** Tests pass. Commit `fix(backlog-sweep): never spend past the AI token cap`.

### Task 6: Token burn — bounded context, rolling summary, prompt caching

**Files:** Create `src/utils/conversationContext.js`. Modify `src/workers/conversation.worker.js` (§8), `src/services/backlogSweep.service.js` (same loader), `src/services/claude.service.js`, `prisma/schema.prisma` (Lead: `historySummary String? @map("history_summary")`, `historySummaryCount Int @default(0) @map("history_summary_count")`, `historySummaryAt DateTime? @map("history_summary_at")`; AiAgentLog: `qualifierCachedTokens Int @default(0)`, `closerCachedTokens Int @default(0)`), same migration as Task 1. Tests `test/conversation-context.test.js`, `test/prompt-caching.test.js`.

**Produces:**
- `loadConversationContext({ tenantId, conversationId, lead, excludeMessageId, paymentDetails, window = 20 }) → { messageHistory, contactMessageCount, earlierSummary }`. `messageHistory` holds the newest `window` rows (sanitized, outbound AUDIO excluded) in asc order.
- `refreshSummaryIfDue({ tenantId, lead, conversationId, paymentDetails }) → boolean`
- `processMessage({ …, earlierSummary, contactMessageCount })`: both are new optional params.
- `generateSummary({ tenantId, messageHistory, priorSummary })`

Constants: `WINDOW = 20` (D1a; `40` for D1b), `SUMMARY_REFRESH_EVERY = 20`.

- [ ] **Step 1: Failing tests**

```js
test('loader fetches only the window, newest-last, and counts ALL lead messages', async () => {
  seedMessages(120);                          // alternating CONTACT / AI, 60 from the contact
  const ctx = await loadConversationContext({ tenantId: 't1', conversationId: 'c1', lead, window: 20 });
  assert.equal(ctx.messageHistory.length, 20);
  assert.equal(ctx.messageHistory.at(-1).id, 'm120');
  assert.equal(ctx.contactMessageCount, 60);  // Closer phase logic unchanged
});
test('Closer messageCount uses contactMessageCount, not window length', () => {
  // buildCloserPrompt spy: processMessage({ messageHistory: last20, contactMessageCount: 60 }) → "Lead messages so far (including this one): 61"
});
test('summary refresh: due only when ≥20 un-summarized messages sit outside the window', async () => {
  // 30 msgs, window 20 → 10 outside → not due; 45 msgs → 25 outside → due; after refresh historySummaryCount=25; 50 msgs → 30-25=5 → not due
});
test('summary is incremental: priorSummary + only the new out-of-window messages are sent', async () => { /* generateSummary spy args */ });
test('bank details are redacted before summarization', async () => { /* paymentDetails account no. never in generateSummary input */ });
test('summary tokens are metered on the subscription', async () => { /* aiTokensUsed increments */ });
test('earlierSummary injected as first history item, AFTER the system prompt (cache prefix intact)', () => {
  // createResponse spy: messages[0].role==='system' && unchanged vs. no-summary call; messages[1].content startsWith 'Earlier in this conversation'
});
test('prompt_cache_key is stable per tenant+agent and cached tokens are logged', async () => {
  // spy: qualifier call has prompt_cache_key 'asos:t1:qualifier'; usage.prompt_tokens_details.cached_tokens=3000 → AiAgentLog.qualifierCachedTokens=3000
});
test('metered tokens discount cached input (D3a)', () => {
  assert.equal(meteredTokens({ prompt_tokens: 5000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 4000 } }), 1000 + 400 + 200);
});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Loader:** `findMany({ where: { conversationId, tenantId, NOT: { type: 'AUDIO', direction: 'OUTBOUND' }, …(excludeMessageId && { id: { not: excludeMessageId } }) }, orderBy: { sentAt: 'desc' }, take: window })`, reversed, then `sanitizeHistoryForAI`. `contactMessageCount = message.count({ where: { conversationId, tenantId, sender: 'CONTACT', id: { not: excludeMessageId } } })`. `earlierSummary = lead.historySummary || null`. The worker's `previousInbound` sentiment lookup is unchanged because it reads the window.
  - **Summary:** `generateSummary` gains `priorSummary`. When it is set, it becomes the first input message (`'Summary so far: …'`) and the instruction changes to "update this running summary with the new messages; keep it under 150 words; keep facts the lead stated (goal, background, objections, fee/payment status)". `refreshSummaryIfDue` runs **after** the reply is sent (fire-and-forget, `.catch(log)`), so it never adds latency to the reply. It fetches the out-of-window messages from `skip: historySummaryCount` in asc order, up to `total - window`, and writes `historySummary`, `historySummaryCount` and `historySummaryAt` with a `where: { id, tenantId }` guard.
  - **Prompt injection:** in `runQualifier` / `runCloser` / `runSupportReply`, when `earlierSummary` is set, prepend `{ role: 'user', content: 'Earlier in this conversation (summary, for context only): …' }` to `history`. The system prompt is byte-identical, so the cache prefix is preserved.
  - **Caching:** `createResponse` gains `cacheKey` and passes `prompt_cache_key: cacheKey`. Callers pass `asos:${tenantId}:${agent}`. Read `resp.usage?.prompt_tokens_details?.cached_tokens || 0` into the log. Add `meteredTokens(usage)` and use it for the `aiTokensUsed` increment (D3a), while `AiAgentLog` keeps the raw `total_tokens`.
  - **Closer `messageCount`:** `contactMessageCount != null ? contactMessageCount + 1 : <old expression>`.
- [ ] **Step 4:** Tests pass, and `npm run lint` is clean.
- [ ] **Step 5:** Run `node scripts/token-burn-report.js --replay [--live]` (D4) and paste the **Before/After** table into the PR:

| Thread | msgs | before in-tok/reply (logged) | after in-tok/reply (replay) | cached share (live) | metered/reply before → after |
|---|---|---|---|---|---|

- [ ] **Step 6:** Commit `perf(ai): bounded history + rolling lead summary + prompt cache key`.

### Task 7: Verify, review, PR

- [ ] `npm test` passes, with only the two pre-existing baseline failures, and `npm run lint` is clean.
- [ ] `npx prisma migrate diff` / `prisma validate` shows the migration is consistent with the schema.
- [ ] Get a fresh code review of the whole branch (superpowers:requesting-code-review).
- [ ] `git push -u origin fix/ai-token-billing` and `gh pr create`. The body covers the findings, decisions taken, before/after table, migration/backfill notes (AiAgentLog recount is a floor) and a rollout checklist. **Do not merge.** Merging to `main` deploys via Railway, and that waits for your approval.
