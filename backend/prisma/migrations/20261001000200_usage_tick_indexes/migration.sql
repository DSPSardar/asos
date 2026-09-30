-- Indexes for the 5-minute 'usage-tick' job's cross-tenant scans
-- (services/usageCycle.service.js):
--   subscriptions: usage_period_end IS NULL (initialise) and <= now() (roll)
--   conversations: handoff_reason = <token-limit reason> AND ai_enabled = false
--                  AND status = 'HUMAN_TAKEOVER' (release)
-- Idempotent (safe to re-run). Plain CREATE INDEX: both tables are small
-- enough that the brief lock during `migrate deploy` is not a concern.

CREATE INDEX IF NOT EXISTS "conversations_handoff_reason_ai_enabled_status_idx" ON "conversations"("handoff_reason", "ai_enabled", "status");

CREATE INDEX IF NOT EXISTS "subscriptions_usage_period_end_idx" ON "subscriptions"("usage_period_end");
