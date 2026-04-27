// src/webhooks/webhook.routes.js

const { Router } = require('express');
const whatsappWebhook = require('./whatsapp.webhook');
const stripeWebhook   = require('./stripe.webhook');

const router = Router();

router.use('/whatsapp', whatsappWebhook);
router.use('/',         stripeWebhook);    // POST /webhooks/stripe

module.exports = router;
