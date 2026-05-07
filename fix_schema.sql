-- Fix all missing schema columns and tables

-- leads: missing v1.5 + DSP fields
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "lead_temperature" TEXT DEFAULT 'WARM',
  ADD COLUMN IF NOT EXISTS "dsp_phase"        TEXT,
  ADD COLUMN IF NOT EXISTS "enrollment_fee"   DECIMAL(12,2);

-- contacts: missing DSP field
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "age_group" TEXT;

-- tenants: brand_profile_id reference
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "brand_profile_id" TEXT;

-- ContentDraftStatus enum
DO $$ BEGIN
  CREATE TYPE "ContentDraftStatus" AS ENUM ('GENERATED','APPROVED','REJECTED','SENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- brand_profiles table
CREATE TABLE IF NOT EXISTS "brand_profiles" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "source_url"       TEXT,
  "source_client_id" TEXT,
  "brand_name"       TEXT,
  "tone"             TEXT,
  "products"         JSONB NOT NULL DEFAULT '[]',
  "audience"         JSONB NOT NULL DEFAULT '[]',
  "colors"           JSONB NOT NULL DEFAULT '[]',
  "logo_url"         TEXT,
  "language_default" TEXT NOT NULL DEFAULT 'en',
  "raw_extraction"   JSONB NOT NULL DEFAULT '{}',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brand_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
);
CREATE INDEX IF NOT EXISTS "brand_profiles_tenant_id_created_at_idx" ON "brand_profiles"("tenant_id","created_at");

-- content_sessions table
CREATE TABLE IF NOT EXISTS "content_sessions" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "brand_profile_id" TEXT,
  "source_url"       TEXT,
  "source_client_id" TEXT,
  "language"         TEXT NOT NULL DEFAULT 'en',
  "generated_count"  INTEGER NOT NULL DEFAULT 0,
  "swipe_decisions"  JSONB NOT NULL DEFAULT '{}',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_sessions_tenant_id_fkey"       FOREIGN KEY ("tenant_id")        REFERENCES "tenants"("id"),
  CONSTRAINT "content_sessions_brand_profile_id_fkey" FOREIGN KEY ("brand_profile_id") REFERENCES "brand_profiles"("id")
);
CREATE INDEX IF NOT EXISTS "content_sessions_tenant_id_created_at_idx" ON "content_sessions"("tenant_id","created_at");

-- content_drafts table
CREATE TABLE IF NOT EXISTS "content_drafts" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "session_id"       TEXT NOT NULL,
  "brand_profile_id" TEXT,
  "campaign_id"      TEXT,
  "language"         TEXT NOT NULL DEFAULT 'en',
  "channel"          TEXT NOT NULL,
  "subject"          TEXT,
  "body"             TEXT NOT NULL,
  "image_url"        TEXT,
  "palette"          JSONB NOT NULL DEFAULT '{}',
  "status"           "ContentDraftStatus" NOT NULL DEFAULT 'GENERATED',
  "metadata"         JSONB NOT NULL DEFAULT '{}',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_drafts_tenant_id_fkey"        FOREIGN KEY ("tenant_id")        REFERENCES "tenants"("id"),
  CONSTRAINT "content_drafts_session_id_fkey"       FOREIGN KEY ("session_id")       REFERENCES "content_sessions"("id"),
  CONSTRAINT "content_drafts_brand_profile_id_fkey" FOREIGN KEY ("brand_profile_id") REFERENCES "brand_profiles"("id"),
  CONSTRAINT "content_drafts_campaign_id_fkey"      FOREIGN KEY ("campaign_id")      REFERENCES "campaigns"("id")
);
CREATE INDEX IF NOT EXISTS "content_drafts_tenant_id_session_id_idx" ON "content_drafts"("tenant_id","session_id");
CREATE INDEX IF NOT EXISTS "content_drafts_tenant_id_status_idx"     ON "content_drafts"("tenant_id","status");

-- client_reports table
CREATE TABLE IF NOT EXISTS "client_reports" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "period_type"   TEXT NOT NULL,
  "language"      TEXT NOT NULL DEFAULT 'en',
  "report_from"   TIMESTAMP(3) NOT NULL,
  "report_to"     TIMESTAMP(3) NOT NULL,
  "summary"       TEXT NOT NULL,
  "pdf_path"      TEXT,
  "sent_to_phone" TEXT,
  "sent_at"       TIMESTAMP(3),
  "metadata"      JSONB NOT NULL DEFAULT '{}',
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
);
CREATE INDEX IF NOT EXISTS "client_reports_tenant_id_created_at_idx" ON "client_reports"("tenant_id","created_at");
