-- AlterTable: add per-tenant payment instructions to ai_configs
-- Sent verbatim by the worker when a lead is ready to pay, so account numbers
-- and IBANs are never retyped (and never truncated) by the AI.
ALTER TABLE "ai_configs"
  ADD COLUMN IF NOT EXISTS "payment_details" TEXT;
