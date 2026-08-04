-- Payment-proof image tracking.
--
-- When a lead sends a payment screenshot we must recognise it deterministically:
-- WhatsApp images reach the AI as the literal string "[Image]", so the model
-- cannot be trusted to spot them. The worker flags the conversation, replies
-- with a fixed acknowledgement, and routes it to a human for verification.

-- New conversation state: proof received, awaiting human verification. Kept
-- separate from HUMAN_TAKEOVER so the inbox can distinguish "money is waiting
-- on you" from an ordinary escalation.
ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION';

-- payment_details_sent_at is the guard that makes detection safe: an inbound
-- image only counts as proof if we actually asked this lead to pay.
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "payment_details_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_proof_detected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "payment_proof_at" TIMESTAMP(3);

-- Fixed acknowledgement sent the instant proof arrives, per tenant.
ALTER TABLE "ai_configs"
  ADD COLUMN IF NOT EXISTS "payment_proof_message" TEXT;

-- Surfaces the verification queue for the agent inbox.
-- Name matches Prisma's default for @@index([tenantId, paymentProofDetected]),
-- so a later `migrate diff` doesn't report drift and try to recreate it.
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_payment_proof_detected_idx"
  ON "conversations" ("tenant_id", "payment_proof_detected");
