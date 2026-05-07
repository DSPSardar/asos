-- AlterTable: add DSP EdTech fields to contacts and leads

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "age_group" TEXT;

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "dsp_phase" TEXT,
  ADD COLUMN IF NOT EXISTS "enrollment_fee" DECIMAL(12,2);
