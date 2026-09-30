-- AI Assistant connector (MCP): per-tenant API keys + a call audit log.
-- Purely additive — no existing table is touched.

CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['read']::TEXT[],
    "created_by" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mcp_call_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "tool" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mcp_call_logs_tenant_id_created_at_idx" ON "mcp_call_logs"("tenant_id", "created_at");

ALTER TABLE "mcp_call_logs"
  ADD CONSTRAINT "mcp_call_logs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_call_logs"
  ADD CONSTRAINT "mcp_call_logs_api_key_id_fkey"
  FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Same fail-closed RLS as every other tenant-scoped table; see
-- 20260811120000_enable_row_level_security. The key -> tenant lookup at the
-- start of an MCP request runs under the named system_scope policy, because
-- no tenant is known until the key has been matched.
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_keys"
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE));
CREATE POLICY system_scope ON "api_keys"
  USING (current_setting('app.rls_scope', TRUE) = 'system')
  WITH CHECK (current_setting('app.rls_scope', TRUE) = 'system');

ALTER TABLE "mcp_call_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mcp_call_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mcp_call_logs"
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE));
CREATE POLICY system_scope ON "mcp_call_logs"
  USING (current_setting('app.rls_scope', TRUE) = 'system')
  WITH CHECK (current_setting('app.rls_scope', TRUE) = 'system');
