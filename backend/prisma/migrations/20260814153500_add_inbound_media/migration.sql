-- Stores inbound WhatsApp media bytes in Postgres instead of a container's
-- local disk.
--
-- Railway's `asos` (API — serves media to the dashboard) and `asos-worker`
-- (downloads inbound WhatsApp media and was writing it to local disk) are
-- separate containers with separate, non-persistent filesystems and no
-- shared volume. A file the worker wrote was invisible to the API service
-- that actually serves it, and would not have survived either service's
-- next redeploy regardless. Storing the bytes in the database removes both
-- problems: any service instance can read a row by id, and the data is
-- durable across deploys the same way every other table here already is.
--
-- No RLS policy is added for this table on purpose: media is served over
-- GET /media/:id with no auth (an <img src> tag cannot send an Authorization
-- header), matching the pre-existing unauthenticated express.static mount
-- for /uploads — access control is the same unguessable-UUID model that
-- content-studio images already relied on, not a new relaxation.

CREATE TABLE IF NOT EXISTS "inbound_media" (
  "id"         TEXT NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "mime_type"  TEXT NOT NULL,
  "data"       BYTEA NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inbound_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inbound_media_tenant_id_idx" ON "inbound_media"("tenant_id");

ALTER TABLE "inbound_media"
  ADD CONSTRAINT "inbound_media_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
