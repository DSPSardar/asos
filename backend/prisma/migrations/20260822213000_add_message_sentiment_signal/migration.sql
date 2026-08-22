-- Per-message AI classification: sentiment + buying-signal type.
-- Written by the conversation worker from the Qualifier's output;
-- read by the /insights endpoints for the AI Insights page.
ALTER TABLE "messages" ADD COLUMN "sentiment" TEXT;
ALTER TABLE "messages" ADD COLUMN "signal_type" TEXT;

-- 7-day inbound aggregation path for /insights/sentiment and /insights/signals
CREATE INDEX "messages_tenant_id_direction_sent_at_idx"
  ON "messages"("tenant_id", "direction", "sent_at");
