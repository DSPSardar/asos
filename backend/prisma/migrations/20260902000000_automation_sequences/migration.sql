-- Multi-touch automation sequences (services/automation.service.js).
-- automation_runs already holds exactly one row per (rule, lead) — the
-- once-per-lead-ever guard — so that row now also carries the lead's
-- progress through a multi-step rule. Existing rows are untouched:
-- step defaults to 1 and the new columns stay NULL.

-- AlterEnum
ALTER TYPE "AutomationRunStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "AutomationRunStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterTable
ALTER TABLE "automation_runs"
  ADD COLUMN IF NOT EXISTS "step" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "next_due_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_touch_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "automation_runs_status_next_due_at_idx" ON "automation_runs"("status", "next_due_at");
