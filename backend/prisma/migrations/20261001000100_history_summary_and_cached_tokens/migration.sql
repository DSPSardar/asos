-- Token burn (utils/conversationContext.js, services/claude.service.js):
--   leads.history_summary*       rolling summary of messages that have left
--                                the AI's verbatim window
--   ai_agent_logs.*_cached_tokens prompt-cache hits, logged so the effect of
--                                prompt caching is measurable per reply
-- Additive, nullable/defaulted columns; idempotent (safe to re-run).

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "history_summary" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "history_summary_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "history_summary_conversation_id" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "history_summary_at" TIMESTAMP(3);

ALTER TABLE "ai_agent_logs" ADD COLUMN IF NOT EXISTS "qualifier_cached_tokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_agent_logs" ADD COLUMN IF NOT EXISTS "closer_cached_tokens" INTEGER NOT NULL DEFAULT 0;
