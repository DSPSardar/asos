// src/services/transcription.service.js
// Speech-to-text for inbound WhatsApp voice notes, via OpenAI's audio
// transcription API. Reuses the existing OPENAI_API_KEY — no new env vars.

const OpenAI = require('openai');
const env = require('../config/env');
const logger = require('../utils/logger');

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

// whisper-1 over gpt-4o-transcribe: its documented supported-formats list
// explicitly includes ogg/oga, which is exactly what WhatsApp voice notes
// are (OGG container, Opus codec) — no conversion needed, the buffer goes
// straight in. It's also the more mature, cheaper endpoint, and short
// sales-chat voice notes don't need gpt-4o-transcribe's extra accuracy.
const TRANSCRIPTION_MODEL = 'whisper-1';

// Returns transcript text, or null on any failure. Must never throw — a
// transcription failure has to fall back to a safe placeholder upstream,
// not crash the worker or block the rest of message processing.
const transcribeAudio = async (buffer, mimeType) => {
  if (!buffer || !buffer.length) return null;

  try {
    const extension = mimeType?.includes('ogg') ? 'ogg' : (mimeType?.split('/')[1]?.split(';')[0] || 'mp3');
    const file = await OpenAI.toFile(buffer, `voice-note.${extension}`, { type: mimeType });

    const res = await client.audio.transcriptions.create({
      file,
      model: TRANSCRIPTION_MODEL,
    });

    const text = res?.text?.trim();
    return text || null;
  } catch (err) {
    logger.error({ err: err.response?.data || err.message }, 'Whisper transcription failed');
    return null;
  }
};

module.exports = { transcribeAudio };
