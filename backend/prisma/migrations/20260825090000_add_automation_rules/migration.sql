-- The /automations page was a hardcoded mock: rules, toggles and run counts
-- lived in the React bundle and nothing ever fired. These two tables back a
-- real IF/THEN engine evaluated by the scheduler worker
-- (services/automation.service.js). automation_runs is the audit trail AND
-- the dedupe guard: the unique (rule_id, lead_id) means a rule can never
-- message the same lead twice, whatever the trigger.

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabled_at" TIMESTAMP(3),
    "trigger" JSONB NOT NULL,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "action" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_rules_tenant_id_enabled_idx" ON "automation_rules"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "automation_runs_tenant_id_rule_id_created_at_idx" ON "automation_runs"("tenant_id", "rule_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_rule_id_lead_id_key" ON "automation_runs"("rule_id", "lead_id");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same fail-closed RLS as every other tenant-scoped table; see
-- 20260811120000_enable_row_level_security for the full rationale.
ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automation_rules"
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE));
CREATE POLICY system_scope ON "automation_rules"
  USING (current_setting('app.rls_scope', TRUE) = 'system')
  WITH CHECK (current_setting('app.rls_scope', TRUE) = 'system');

ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automation_runs"
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE));
CREATE POLICY system_scope ON "automation_runs"
  USING (current_setting('app.rls_scope', TRUE) = 'system')
  WITH CHECK (current_setting('app.rls_scope', TRUE) = 'system');
