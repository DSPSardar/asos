// src/utils/aiHistory.js
//
// The configured payment/bank details are sent to the lead verbatim
// (conversation.worker.js → sendPaymentInstructions) and land in the Message
// table like any other outbound text — which is right for the dashboard and
// the audit trail, but means every later AI turn that loads conversation
// history would ship the account numbers to the LLM provider (and, before
// this existed, to ElevenLabs TTS). Account numbers must never travel
// further than WhatsApp and the dashboard, so every path that assembles
// history for an AI call redacts them here first.
//
// Matching is by exact content equality with the tenant's current
// paymentDetails config. Rows sent under an older, since-edited config won't
// match — acceptable residual, since details rarely change and the window is
// only the conversations still open across the edit.

const PAYMENT_DETAILS_PLACEHOLDER =
  '[Payment instructions were sent to the lead as a separate message]';

const sanitizeHistoryForAI = (messages, paymentDetails) => {
  const details = paymentDetails?.trim();
  if (!details) return messages;

  return (messages || []).map((m) =>
    m.content && m.content.trim() === details
      ? { ...m, content: PAYMENT_DETAILS_PLACEHOLDER }
      : m
  );
};

module.exports = { sanitizeHistoryForAI, PAYMENT_DETAILS_PLACEHOLDER };
