-- Records when a conversation was actually handed off to a human.
--
-- handoffReason already existed, but nothing recorded WHEN — so an escalation
-- SLA could not be measured, even retroactively, since updatedAt is touched
-- by any later change to the row, not just the HUMAN_TAKEOVER transition.
-- handleHandoff() in conversation.worker.js is the single write point for
-- that transition, so this is set there and nowhere else.

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "handoff_at" TIMESTAMP(3);
