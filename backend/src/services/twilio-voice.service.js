const twilio = require('twilio');
const env = require('../config/env');
const logger = require('../utils/logger');

const requireCallingConfig = () => {
  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'VOICE_WEBHOOK_BASE_URL']
    .filter((key) => !env[key]);
  if (missing.length) {
    throw Object.assign(new Error(`WhatsApp Calling is not configured: ${missing.join(', ')}`), { statusCode: 503 });
  }
};

const client = () => {
  requireCallingConfig();
  return twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
};

const requirePhoneCallingConfig = () => {
  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_FROM', 'VOICE_WEBHOOK_BASE_URL']
    .filter((key) => !env[key]);
  if (missing.length) {
    throw Object.assign(new Error(`Phone Calling is not configured: ${missing.join(', ')}`), { statusCode: 503 });
  }
};

const phoneClient = () => {
  requirePhoneCallingConfig();
  return twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
};

const normalizeWhatsAppAddress = (phone) => {
  const value = String(phone || '').trim();
  if (!value) throw Object.assign(new Error('A recipient phone number is required'), { statusCode: 400 });
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value.startsWith('+') ? value : `+${value}`}`;
};

const requestCall = async ({ to, leadId, tenantId }) => {
  const recipient = normalizeWhatsAppAddress(to);
  const voiceUrl = new URL('/webhooks/twilio/voice', env.VOICE_WEBHOOK_BASE_URL);
  voiceUrl.searchParams.set('leadId', leadId);
  voiceUrl.searchParams.set('tenantId', tenantId);

  const call = await client().calls.create({
    to: recipient,
    from: normalizeWhatsAppAddress(env.TWILIO_WHATSAPP_FROM),
    url: voiceUrl.toString(),
    method: 'POST',
  });

  logger.info({ callSid: call.sid, leadId, tenantId }, 'WhatsApp voice call requested');
  return { callSid: call.sid, status: call.status };
};

const normalizePhoneNumber = (phone) => {
  const value = String(phone || '').trim().replace(/^whatsapp:/, '');
  if (!value) throw Object.assign(new Error('A recipient phone number is required'), { statusCode: 400 });
  return value.startsWith('+') ? value : `+${value}`;
};

const requestPhoneCall = async ({ to, leadId, tenantId }) => {
  const recipient = normalizePhoneNumber(to);
  const voiceUrl = new URL('/webhooks/twilio/voice', env.VOICE_WEBHOOK_BASE_URL);
  voiceUrl.searchParams.set('leadId', leadId);
  voiceUrl.searchParams.set('tenantId', tenantId);

  const call = await phoneClient().calls.create({
    to: recipient,
    from: normalizePhoneNumber(env.TWILIO_VOICE_FROM),
    url: voiceUrl.toString(),
    method: 'POST',
  });

  logger.info({ callSid: call.sid, leadId, tenantId }, 'Phone voice call requested');
  return { callSid: call.sid, status: call.status };
};

module.exports = {
  requestCall,
  requestPhoneCall,
  normalizeWhatsAppAddress,
  normalizePhoneNumber,
  requireCallingConfig,
  requirePhoneCallingConfig,
};
