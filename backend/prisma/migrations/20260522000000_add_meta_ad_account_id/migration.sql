-- Add meta_ad_account_id to Tenant for Meta Ads integration
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "meta_ad_account_id" TEXT;
