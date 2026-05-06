-- AlterTable: add AI Settings UI fields to ai_configs
ALTER TABLE "ai_configs"
  ADD COLUMN IF NOT EXISTS "tone" TEXT NOT NULL DEFAULT 'Professional',
  ADD COLUMN IF NOT EXISTS "closer_model" TEXT,
  ADD COLUMN IF NOT EXISTS "monthly_budget" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "handoff_rules" JSONB NOT NULL DEFAULT '{}'::jsonb;
