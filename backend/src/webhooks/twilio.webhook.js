const { Router } = require('express');
const twilio = require('twilio');
const env = require('../config/env');
const logger = require('../utils/logger');
const { createVoiceReply } = require('../services/voice-agent.service');

const router = Router();
const MAX_TURNS = 4;

const callbackUrl = (path, query) => {
  const url = new URL(path, env.VOICE_WEBHOOK_BASE_URL);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
};

const parseTurn = (value) => Math.max(0, Math.min(MAX_TURNS, Number.parseInt(value, 10) || 0));

const gather = ({ prompt, query, turn }) => {
  const response = new twilio.twiml.VoiceResponse();
  const nextQuery = { ...query, turn };
  const input = response.gather({
    input: 'speech',
    action: callbackUrl('/webhooks/twilio/gather', nextQuery),
    method: 'POST',
    speechTimeout: 'auto',
    timeout: 6,
    actionOnEmptyResult: true,
  });
  input.say({ voice: 'alice' }, prompt);
  response.redirect({ method: 'POST' }, callbackUrl('/webhooks/twilio/voice', nextQuery));
  return response.toString();
};

router.post('/voice', (req, res) => {
  const turn = parseTurn(req.query.turn);
  const prompt = turn === 0
    ? 'Assalam o alaikum. Main Digital Services Program ka AI assistant hoon. Main Bootcamp ke bare mein basic maloomat aur human follow up mein help kar sakta hoon. Kya aap AI agents seekhne mein interested hain?'
    : 'Main aapki baat nahi sun saka. Kya aap dobara keh sakte hain?';

  res.type('text/xml').send(gather({ prompt, query: req.query, turn }));
});

router.post('/gather', async (req, res) => {
  const turn = parseTurn(req.query.turn);
  const speech = String(req.body?.SpeechResult || '').trim();

  if (!speech) {
    return res.type('text/xml').send(gather({
      prompt: 'Main aapki awaaz theek se nahi sun saka. Kya aap dobara keh sakte hain?',
      query: req.query,
      turn,
    }));
  }

  if (turn >= MAX_TURNS) {
    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: 'alice' }, 'Shukriya. Hamari team aap se follow up karegi. Allah hafiz.');
    response.hangup();
    return res.type('text/xml').send(response.toString());
  }

  const reply = await createVoiceReply({ speech, leadId: req.query.leadId });
  logger.info({ leadId: req.query.leadId, turn, speechLength: speech.length }, 'Twilio voice turn processed');
  return res.type('text/xml').send(gather({
    prompt: reply,
    query: req.query,
    turn: turn + 1,
  }));
});

module.exports = router;
