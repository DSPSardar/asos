// src/webhooks/webhook.routes.js

const { Router } = require('express');
const whatsappWebhook = require('./whatsapp.webhook');
const stripeWebhook   = require('./stripe.webhook');
const masteryWebhook  = require('./mastery.webhook');
const elevenLabsWebhook = require('./elevenlabs.webhook');

const router = Router();

router.use('/whatsapp', whatsappWebhook);
router.use('/mastery',  masteryWebhook);    // POST /webhooks/mastery — course → CRM events
router.use('/elevenlabs', elevenLabsWebhook); // POST /webhooks/elevenlabs/{lead,escalate} — WhatsApp voice agent tools
router.use('/',         stripeWebhook);    // POST /webhooks/stripe

module.exports = router;
