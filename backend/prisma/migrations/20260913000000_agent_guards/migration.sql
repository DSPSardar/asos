-- Agent guards for the fully-automatic sales agent (services/agent-guards/).
-- All columns are nullable, so existing rows are untouched.

-- AlterTable: leads
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "form_submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "already_enrolled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "language" TEXT;

-- AlterTable: contacts
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "opted_out_at" TIMESTAMP(3);
