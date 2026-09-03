// src/webhooks/webhook.routes.js

const { Router } = require('express');
const whatsappWebhook = require('./whatsapp.webhook');
const stripeWebhook   = require('./stripe.webhook');
const masteryWebhook  = require('./mastery.webhook');

const router = Router();

router.use('/whatsapp', whatsappWebhook);
router.use('/mastery',  masteryWebhook);    // POST /webhooks/mastery — course → CRM events
router.use('/',         stripeWebhook);    // POST /webhooks/stripe

module.exports = router;
