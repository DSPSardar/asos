// src/webhooks/stripe.webhook.js
// Handles Stripe billing events — raw body required for signature verification

const { Router } = require('express');
const Sentry = require('@sentry/node');
const billingService = require('../modules/billing/billing.service');
const logger = require('../utils/logger');
const env = require('../config/env');
const { runWithSystemScope } = require('../middleware/requestContext.middleware');

const router = Router();

// Raw body is already applied in app.js via express.raw() for /webhooks/*
router.post('/stripe', async (req, res) => {
  const signature = req.headers['stripe-signature'];

  if (!signature) {
    logger.warn({ event: 'webhook.stripe.rejected', reason: 'missing_signature' }, 'Stripe webhook missing signature header');
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    logger.error({ event: 'webhook.stripe.rejected', reason: 'not_configured' }, 'STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Billing not configured' });
  }

  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    // System RLS scope: the tenant is resolved *inside* handleWebhook from
    // the signature-verified Stripe event (stripeCustomerId → tenant), so no
    // per-tenant context exists yet at this point. Signature check above is
    // what gates entry; the scope use is logged via the pino mixin.
    const result  = await runWithSystemScope(() => billingService.handleWebhook(rawBody, signature));
    logger.info({ event: 'webhook.stripe.accepted' }, 'Stripe webhook processed');
    return res.status(200).json(result);
  } catch (err) {
    logger.error({ event: 'webhook.stripe.error', err: err.message }, 'Stripe webhook processing failed');
    // Not covered by Express's own error-handling chain — this route
    // catches its own errors and shapes its own response rather than
    // calling next(err).
    Sentry.captureException(err);
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
});

module.exports = router;
