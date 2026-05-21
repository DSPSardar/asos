-- Add PENDING_APPROVAL to TenantStatus enum
-- Prisma enums in PostgreSQL require: rename old → add new value → drop old

ALTER TYPE "TenantStatus" ADD VALUE 'PENDING_APPROVAL';
