-- Bootcamp sunset (2026-08): AI Agent Mastery is the only product, so new
-- leads default to MASTERY. Default-only change — existing rows (including
-- BOOTCAMP and NULL products) are deliberately left untouched.

-- AlterTable
ALTER TABLE "leads" ALTER COLUMN "product" SET DEFAULT 'MASTERY';
