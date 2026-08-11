-- Enable Postgres row-level security on every tenant-scoped table.
--
-- Written by hand (SQL-only migration): RLS is not representable in
-- schema.prisma, so `prisma migrate dev` cannot generate it. No columns
-- change — every table below already has tenant_id TEXT NOT NULL.
--
-- Two permissive policies per table (they OR together):
--   tenant_isolation  row visible/writable only when the row's tenant_id
--                     equals current_setting('app.current_tenant_id') —
--                     set per-transaction by src/config/database.js from
--                     the verified request/job context.
--   system_scope      full access when app.rls_scope = 'system' — the
--                     explicit, logged path for SUPERADMIN requests, the
--                     Stripe webhook, and ops scripts. A named policy, not
--                     a superuser bypass.
--
-- With neither setting present, current_setting(..., TRUE) is NULL and both
-- policies evaluate to not-true: zero rows. Fail closed.
--
-- FORCE is required, not optional: the Railway DATABASE_URL user owns these
-- tables, and Postgres exempts table owners from RLS unless forced.
--
-- Deliberately exempt (identity roots consulted before any tenant context
-- can exist):
--   tenants  — webhook waPhoneId→tenant lookup, login, registration
--   users    — login by email, JWT→user resolution in auth middleware
-- Cross-tenant reads of these two remain guarded by the application layer
-- only. Do not add customer conversation/lead/billing data to them.
--
-- Deploy note: the asos service runs this migration on boot; until the
-- worker redeploys with the matching code (same push), its jobs fail closed
-- and BullMQ retries them (5 attempts, exponential backoff) — self-healing,
-- no lost messages.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts',
    'leads',
    'conversations',
    'messages',
    'campaigns',
    'activities',
    'ads_tracking',
    'ai_agent_logs',
    'knowledge_gaps',
    'ai_configs',
    'subscriptions',
    'manual_payments',
    'brand_profiles',
    'content_sessions',
    'content_drafts',
    'client_reports'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      $p$CREATE POLICY tenant_isolation ON %I
           USING (tenant_id = current_setting('app.current_tenant_id', TRUE))
           WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE))$p$, t);
    EXECUTE format(
      $p$CREATE POLICY system_scope ON %I
           USING (current_setting('app.rls_scope', TRUE) = 'system')
           WITH CHECK (current_setting('app.rls_scope', TRUE) = 'system')$p$, t);
  END LOOP;
END
$$;
