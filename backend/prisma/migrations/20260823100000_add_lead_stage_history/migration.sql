-- Stage transitions were only recoverable from free-text Activity rows, so
-- analytics could not tell where a CLOSED_LOST lead dropped out, and
-- time-in-stage / sales-cycle metrics were unmeasurable. Every stage write
-- now also appends a row here (worker AI updates, manual updateStage,
-- confirmPayment, and lead creation).

CREATE TABLE "lead_stage_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "from_stage" "LeadStage",
    "to_stage" "LeadStage" NOT NULL,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_stage_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_stage_history_tenant_id_lead_id_idx"
  ON "lead_stage_history"("tenant_id", "lead_id");
CREATE INDEX "lead_stage_history_lead_id_created_at_idx"
  ON "lead_stage_history"("lead_id", "created_at");

ALTER TABLE "lead_stage_history"
  ADD CONSTRAINT "lead_stage_history_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Same fail-closed RLS as every other tenant-scoped table; see
-- 20260811120000_enable_row_level_security for the full rationale.
ALTER TABLE "lead_stage_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_stage_history" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "lead_stage_history"
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE));

CREATE POLICY system_scope ON "lead_stage_history"
  USING (current_setting('app.rls_scope', TRUE) = 'system')
  WITH CHECK (current_setting('app.rls_scope', TRUE) = 'system');
