-- Duplicate-screenshot detection for the payment-proof flow: store a content
-- hash of every inbound media blob so a reused receipt image can be flagged
-- to the human reviewer instead of sailing through as a fresh proof.

ALTER TABLE "inbound_media" ADD COLUMN "sha256" TEXT;

-- Backfill existing rows (pg_catalog.sha256 exists on PostgreSQL 11+).
UPDATE "inbound_media" SET "sha256" = encode(sha256("data"), 'hex') WHERE "sha256" IS NULL;

CREATE INDEX "inbound_media_tenant_id_sha256_idx" ON "inbound_media"("tenant_id", "sha256");
