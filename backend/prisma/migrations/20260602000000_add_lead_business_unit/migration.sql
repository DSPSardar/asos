-- CreateEnum: business unit classifier for DSP vs Sunnah Diagnostic leads

CREATE TYPE "LeadBusinessUnit" AS ENUM ('DSP', 'SDC', 'UNKNOWN');

-- AlterTable: add business_unit column to leads

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "business_unit" "LeadBusinessUnit" NOT NULL DEFAULT 'UNKNOWN';
