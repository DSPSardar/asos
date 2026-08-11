-- Manual bank-transfer payments.
--
-- Stripe cannot receive payments for a Pakistani business, so clients pay by
-- direct bank transfer and send a screenshot. Until now there was no record of
-- any of it: an admin could set tenants.plan by hand, but that stored no
-- amount, no date, no proof, and no period end — so a paid plan never lapsed
-- and nothing could be reconciled against the bank statement.
--
-- Not to be confused with the payment-proof columns on "conversations", which
-- track a *lead* paying a *tenant* over WhatsApp. This is a *tenant* paying us.

DO $$ BEGIN
  CREATE TYPE "ManualPaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "manual_payments" (
  "id"              TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,

  "amount"          DECIMAL(12,2) NOT NULL,
  "currency"        TEXT NOT NULL DEFAULT 'PKR',
  "paid_at"         TIMESTAMP(3) NOT NULL,
  "reference"       TEXT,

  "plan"            "TenantPlan" NOT NULL,
  "period_months"   INTEGER NOT NULL DEFAULT 1,

  -- Screenshot stored in-row: Railway's filesystem is ephemeral and wipes
  -- /app/uploads on every redeploy, which is unacceptable for a payment trail.
  -- Size cap and MIME allowlist are enforced in the upload route.
  "proof_image"     BYTEA,
  "proof_mime_type" TEXT,
  "proof_filename"  TEXT,

  "status"          "ManualPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "notes"           TEXT,
  "reviewed_by_id"  TEXT,
  "reviewed_at"     TIMESTAMP(3),
  "review_note"     TEXT,

  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "manual_payments_pkey" PRIMARY KEY ("id")
);

-- Index names match Prisma's defaults for @@index([tenantId, status]) and
-- @@index([status, createdAt]) so a later `migrate diff` does not report drift.
CREATE INDEX IF NOT EXISTS "manual_payments_tenant_id_status_idx"
  ON "manual_payments" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "manual_payments_status_created_at_idx"
  ON "manual_payments" ("status", "created_at");

DO $$ BEGIN
  ALTER TABLE "manual_payments"
    ADD CONSTRAINT "manual_payments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
