// src/services/elevenlabs.service.js
// ElevenLabs text-to-speech — turns an AI reply into a voice note in the
// business owner's cloned voice. Entirely inert unless both
// ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are configured; callers must
// check isVoiceCloneConfigured() before doing any TTS work.

const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

const isVoiceCloneConfigured = () => {
  return Boolean(
    env.ELEVENLABS_API_KEY && env.ELEVENLABS_API_KEY.trim() &&
    env.ELEVENLABS_VOICE_ID && env.ELEVENLABS_VOICE_ID.trim()
  );
};

// Returns { buffer, mimeType } on success, or null on any failure — a TTS
// error must never block or break the text reply that already went out.
// Emits MP3 (ElevenLabs' default), not OGG/Opus: WhatsApp accepts MP3 as a
// regular playable audio attachment, just not the native voice-note waveform
// bubble (that's reserved for mono OGG/Opus). Getting OGG/Opus would mean
// transcoding with ffmpeg, which isn't installed in this image — MP3 keeps
// the feature dependency-free per the "no-op until configured" requirement.
const textToSpeech = async (text) => {
  if (!isVoiceCloneConfigured()) return null;
  if (!text || !text.trim()) return null;

  try {
    const res = await axios.post(
      `${ELEVENLABS_API_URL}/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: {
          'xi-api-key': env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        params: { output_format: 'mp3_44100_128' },
        responseType: 'arraybuffer',
        timeout: 30000,
      }
    );

    return { buffer: Buffer.from(res.data), mimeType: 'audio/mpeg' };
  } catch (err) {
    // Error responses also come back as arraybuffer (JSON body as bytes) —
    // decode it for a readable log instead of dumping raw bytes.
    let apiError = err.message;
    if (Buffer.isBuffer(err.response?.data)) {
      try { apiError = JSON.parse(err.response.data.toString('utf8')); } catch { /* leave as message */ }
    } else if (err.response?.data) {
      apiError = err.response.data;
    }
    logger.error({ err: apiError }, 'ElevenLabs TTS request failed');
    return null;
  }
};

module.exports = {
  textToSpeech,
  isVoiceCloneConfigured,
};
