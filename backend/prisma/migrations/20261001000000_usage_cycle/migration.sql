-- AI-usage cycle (services/usageCycle.service.js).
--
-- subscriptions.current_period_* is the PAID-THROUGH date (Stripe, or a
-- manual bank-transfer payment that can cover several months). Usage needs
-- its own monthly cycle, reset by the 'usage-tick' scheduler job — before
-- this, current_period_end was NULL for most tenants and ai_tokens_used had
-- accumulated since launch until the cap silently paused the AI.
--
-- Every statement is idempotent: safe to re-run.

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "usage_period_start" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "usage_period_end" TIMESTAMP(3);

-- subscriptions and ai_agent_logs are FORCE ROW LEVEL SECURITY; the backfill
-- below is a cross-tenant ops write, so it runs under the explicit
-- system_scope policy (see 20260811120000_enable_row_level_security).
SELECT set_config('app.rls_scope', 'system', false);

-- Backfill: anchor each cycle on the subscription's created_at; the current
-- period is the one containing now(). Interval arithmetic clamps month ends
-- (Jan 31 + 1 month = Feb 28), and both ends are computed from created_at so
-- a 31st-anchored cycle never drifts to the 28th.
--
-- Non-Stripe tenants' ai_tokens_used is recounted from the audit log for the
-- current period (it had accumulated since launch). This is a FLOOR: support
-- replies and summaries are metered on the subscription but not in
-- ai_agent_logs. Stripe tenants keep their counter — their renewal webhook
-- already resets it.
--
-- Only rows without a usage period are touched, so a re-run changes nothing.
--
-- age() can land one period short around clamped month ends (a Jan 31
-- anchor on Sep 30 gives 7 months → Aug 31..Sep 30 00:00, already over), so
-- n is bumped once when the following period has already started.
WITH a AS (
  SELECT
    s.id,
    s.tenant_id,
    s.stripe_sub_id,
    s.created_at,
    (date_part('year',  age(now() AT TIME ZONE 'UTC', s.created_at)) * 12
   + date_part('month', age(now() AT TIME ZONE 'UTC', s.created_at)))::int AS n0
  FROM "subscriptions" s
  WHERE s.usage_period_start IS NULL
), p AS (
  SELECT a.*,
    CASE WHEN a.created_at + make_interval(months => a.n0 + 1) <= now() AT TIME ZONE 'UTC'
         THEN a.n0 + 1 ELSE a.n0 END AS n
  FROM a
)
UPDATE "subscriptions" s SET
  usage_period_start = p.created_at + make_interval(months => p.n),
  usage_period_end   = p.created_at + make_interval(months => p.n + 1),
  ai_tokens_used = CASE
    WHEN p.stripe_sub_id IS NULL THEN COALESCE((
      SELECT SUM(l.qualifier_tokens + l.closer_tokens)
      FROM "ai_agent_logs" l
      WHERE l.tenant_id = p.tenant_id
        AND l.created_at >= p.created_at + make_interval(months => p.n)
    ), 0)
    ELSE s.ai_tokens_used
  END
FROM p
WHERE s.id = p.id;

SELECT set_config('app.rls_scope', '', false);

-- Internal tenant: metered, never capped (services/usageCycle.service.js
-- isBillingExempt). jsonb_set overwrites with the same value on re-run.
UPDATE "tenants"
SET "settings" = jsonb_set(COALESCE("settings", '{}'::jsonb), '{billingExempt}', 'true'::jsonb, true)
WHERE "id" = '87bfa1b0-1774-4278-b630-d30836cf4183';
