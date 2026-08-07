-- CreateEnum
CREATE TYPE "ContentDraftStatus" AS ENUM ('GENERATED', 'SAVED', 'SKIPPED', 'PUBLISHED', 'SENT_FOR_APPROVAL');

-- AlterTable
ALTER TABLE "ai_configs" ADD COLUMN     "welcome_voice_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "welcome_voice_file_path" TEXT,
ADD COLUMN     "welcome_voice_media_id" TEXT,
ADD COLUMN     "welcome_voice_uploaded_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "sent_welcome_voice" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "brand_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_url" TEXT,
    "source_client_id" TEXT,
    "brand_name" TEXT,
    "tone" TEXT,
    "products" JSONB NOT NULL DEFAULT '[]',
    "audience" JSONB NOT NULL DEFAULT '[]',
    "colors" JSONB NOT NULL DEFAULT '[]',
    "logo_url" TEXT,
    "language_default" TEXT NOT NULL DEFAULT 'en',
    "raw_extraction" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "brand_profile_id" TEXT,
    "source_url" TEXT,
    "source_client_id" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "generated_count" INTEGER NOT NULL DEFAULT 0,
    "swipe_decisions" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_drafts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "brand_profile_id" TEXT,
    "campaign_id" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "image_url" TEXT,
    "palette" JSONB NOT NULL DEFAULT '{}',
    "status" "ContentDraftStatus" NOT NULL DEFAULT 'GENERATED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_type" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "report_from" TIMESTAMP(3) NOT NULL,
    "report_to" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "pdf_path" TEXT,
    "sent_to_phone" TEXT,
    "sent_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_profiles_tenant_id_created_at_idx" ON "brand_profiles"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "content_sessions_tenant_id_created_at_idx" ON "content_sessions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "content_drafts_tenant_id_session_id_idx" ON "content_drafts"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "content_drafts_tenant_id_status_idx" ON "content_drafts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "client_reports_tenant_id_created_at_idx" ON "client_reports"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_sessions" ADD CONSTRAINT "content_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_sessions" ADD CONSTRAINT "content_sessions_brand_profile_id_fkey" FOREIGN KEY ("brand_profile_id") REFERENCES "brand_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "content_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_brand_profile_id_fkey" FOREIGN KEY ("brand_profile_id") REFERENCES "brand_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
