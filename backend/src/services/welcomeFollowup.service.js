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

/**
 * Catch-up for contacts who got the welcome note BEFORE the follow-up text
 * existed (or never got it): on their next message, send the welcome voice
 * note + the follow-up text once, then let the normal AI reply run.
 * Skips paid / already-enrolled leads. Returns true when it sent.
 */
const sendCatchUpWelcome = async ({ tenant, contact, lead, phone, conversationId, prisma, whatsappService, welcomeVoiceService, logger, delayMs = FOLLOWUP_DELAY_MS }) => {
  const text = welcomeFollowupText(tenant);
  const ai = tenant?.aiConfig;
  if (!text || !ai?.welcomeVoiceEnabled || !ai?.welcomeVoiceMediaId) return false;
  if (!contact?.sentWelcomeVoice) return false; // brand-new contacts take the normal welcome path
  if (!lead || lead.stage === 'CLOSED_WON' || lead.alreadyEnrolledAt) return false;
  const already = await prisma.message.findFirst({
    where: { tenantId: tenant.id, direction: 'OUTBOUND', content: text, conversation: { contactId: contact.id } },
    select: { id: true },
  });
  if (already) return false;

  let voiceId = null;
  try {
    voiceId = await welcomeVoiceService.sendWelcomeVoice(tenant, ai, phone);
  } catch (err) {
    logger.error({ err, contactId: contact.id }, 'Catch-up welcome voice failed');
  }
  await prisma.message.create({
    data: { tenantId: tenant.id, conversationId, waMessageId: voiceId, direction: 'OUTBOUND', sender: 'AI', type: 'AUDIO', content: '[Welcome voice note]', status: voiceId ? 'SENT' : 'FAILED' },
  }).catch((err) => logger.error({ err }, 'Catch-up voice not recorded'));
  // The link goes even if the voice failed — the link is what converts.
  const linkId = await sendWelcomeFollowup({ tenant, phone, conversationId, prisma, whatsappService, logger, delayMs: voiceId ? delayMs : 0 });
  logger.info({ contactId: contact.id, conversationId, voice: !!voiceId, link: !!linkId }, '🎬 Catch-up welcome (voice + video link) sent');
  return !!linkId;
};

module.exports = { welcomeFollowupText, sendWelcomeFollowup, sendCatchUpWelcome, FOLLOWUP_DELAY_MS };
