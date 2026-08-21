-- inbound_media was added after 20260811120000_enable_row_level_security and
-- never picked up the policies every other tenant-scoped table has. It holds
-- raw inbound WhatsApp media bytes — payment-proof screenshots included — so
-- it needs the same fail-closed treatment. Same two permissive policies as
-- the original migration; see that file for the full rationale.
--
-- Writers/readers today: whatsapp.service.js saveInboundMedia() (worker,
-- runs under the job's tenant context → tenant_isolation) and the /media/:id
-- route in app.js (runWithSystemScope → system_scope).

ALTER TABLE "inbound_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbound_media" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "inbound_media"
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE));

CREATE POLICY system_scope ON "inbound_media"
  USING (current_setting('app.rls_scope', TRUE) = 'system')
  WITH CHECK (current_setting('app.rls_scope', TRUE) = 'system');
