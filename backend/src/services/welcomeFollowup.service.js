/**
 * Optional text sent straight after the welcome voice note — e.g. the
 * masterclass video link. Per tenant via tenant.settings.welcomeFollowupText;
 * unset or blank means nothing extra is sent (every other tenant unchanged).
 */
const FOLLOWUP_DELAY_MS = 2000;

const welcomeFollowupText = (tenant) => {
  const v = tenant?.settings?.welcomeFollowupText;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends the follow-up text and records it on the conversation.
 * Never throws: a failure here must not undo the voice note that already went.
 */
const sendWelcomeFollowup = async ({ tenant, phone, conversationId, prisma, whatsappService, logger, delayMs = FOLLOWUP_DELAY_MS }) => {
  const text = welcomeFollowupText(tenant);
  if (!text) return null;
  if (delayMs) await sleep(delayMs); // let the voice note land first in the chat
  let waMessageId = null;
  try {
    waMessageId = await whatsappService.sendText(tenant, phone, text, { previewUrl: /https?:\/\//.test(text) });
  } catch (err) {
    logger.error({ err, conversationId }, 'Welcome follow-up text send failed');
  }
  try {
    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId,
        waMessageId,
        direction: 'OUTBOUND',
        sender: 'AI',
        type: 'TEXT',
        content: text,
        status: waMessageId ? 'SENT' : 'FAILED',
      },
    });
  } catch (err) {
    logger.error({ err, conversationId }, 'Welcome follow-up text could not be recorded');
  }
  return waMessageId;
};

module.exports = { welcomeFollowupText, sendWelcomeFollowup, FOLLOWUP_DELAY_MS };
