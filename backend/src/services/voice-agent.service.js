const OpenAI = require('openai');
const env = require('../config/env');
const logger = require('../utils/logger');

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const FALLBACK_REPLY = 'Maazrat, main abhi jawab record nahi kar pa raha. Hamari team aap se follow up karegi. Shukriya.';

const cleanSpeech = (value) => String(value || '')
  .replace(/[\u0000-\u001F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 1200);

const createVoiceReply = async ({ speech, leadId }) => {
  const input = cleanSpeech(speech);
  if (!input) return 'Main aapki baat theek se nahi sun saka. Kya aap dobara keh sakte hain?';

  try {
    const response = await client.responses.create({
      model: env.OPENAI_MODEL,
      max_output_tokens: 120,
      instructions: `You are the DSP AI Assistant for Digital Services Program Bootcamp on a phone call.
Speak in clear, friendly Roman Urdu with simple English only when helpful.
Always state or preserve that you are an AI assistant, not Sardar Abdul Ghaffar Khan.
Your job is to answer basic Bootcamp questions, discover interest, and offer a human follow-up.
Never collect card, bank, OTP, password, or payment details. Never invent fees, certificates, dates, jobs, or guarantees.
If the caller asks not to be called, acknowledge it politely and say their number will be marked do-not-call.
Keep each answer under two short sentences and finish with one natural question unless they want to end the call.`,
      input: `Caller said: ${input}`,
    });

    return cleanSpeech(response.output_text) || FALLBACK_REPLY;
  } catch (err) {
    logger.error({ err, leadId }, 'Voice agent OpenAI request failed');
    return FALLBACK_REPLY;
  }
};

module.exports = { createVoiceReply, cleanSpeech };
