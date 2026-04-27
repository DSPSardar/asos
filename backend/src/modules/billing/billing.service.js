// src/modules/billing/billing.service.js — Full Stripe Integration

const prisma  = require('../../config/database');
const logger  = require('../../utils/logger');
const env     = require('../../config/env');

let stripe;
const getStripe = () => {
  if (!stripe) stripe = require('stripe')(env.STRIPE_SECRET_KEY);
  return stripe;
};

// ── Plan config ───────────────────────────────────────────────
const PLANS = {
  FREE: {
    priceId:       null,
    contactsLimit: 100,
    aiTokensLimit: 100_000n,
    messagesLimit: 1_000,
    amount:        0,
  },
  PRO: {
    priceId:       process.env.STRIPE_PRICE_PRO,        // e.g. price_xxx from Stripe dashboard
    contactsLimit: 5_000,
    aiTokensLimit: 5_000_000n,
    messagesLimit: 50_000,
    amount:        29700,   // R$ 297.00 in cents
  },
  ENTERPRISE: {
    priceId:       process.env.STRIPE_PRICE_ENTERPRISE,
    contactsLimit: 99_999,
    aiTokensLimit: 100_000_000n,
    messagesLimit: 999_999,
    amount:        99700,
  },
};

// ── Get subscription + usage ──────────────────────────────────

const getSubscription = async (tenantId) => {
  const [sub, contactCount] = await Promise.all([
    prisma.subscription.findUnique({ where: { tenantId }, include: { tenant: { select: { name: true, stripeCustomerId: true } } } }),
    prisma.contact.count({ where: { tenantId } }),
  ]);

  if (!sub) throw Object.assign(new Error('Subscription not found'), { statusCode: 404, expose: true });

  const planConfig = PLANS[sub.plan] || PLANS.FREE;

  return {
    plan:              sub.plan,
    status:            sub.status,
    currentPeriodEnd:  sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.stripeSubId ? await getCancelStatus(sub.stripeSubId) : false,
    limits: {
      contacts: { used: contactCount,                         limit: sub.contactsLimit  },
      messages: { used: sub.messagesUsed,                     limit: sub.messagesLimit  },
      aiTokens: { used: Number(sub.aiTokensUsed),             limit: Number(sub.aiTokensLimit) },
    },
    usagePercent: {
      contacts: Math.round((contactCount / sub.contactsLimit) * 100),
      messages:  Math.round((sub.messagesUsed / sub.messagesLimit) * 100),
      aiTokens:  Math.round((Number(sub.aiTokensUsed) / Number(sub.aiTokensLimit)) * 100),
    },
  };
};

const getCancelStatus = async (stripeSubId) => {
  try {
    const sub = await getStripe().subscriptions.retrieve(stripeSubId);
    return sub.cancel_at_period_end;
  } catch { return false; }
};

// ── Create Stripe customer ────────────────────────────────────

const ensureStripeCustomer = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { users: { where: { role: 'TENANT_ADMIN' }, take: 1 } },
  });

  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;

  const admin = tenant.users[0];
  const customer = await getStripe().customers.create({
    email:    admin?.email,
    name:     tenant.name,
    metadata: { tenantId, tenantSlug: tenant.slug },
  });

  await prisma.tenant.update({
    where: { id: tenantId },
    data:  { stripeCustomerId: customer.id },
  });

  logger.info({ tenantId, customerId: customer.id }, 'Stripe customer created');
  return customer.id;
};

// ── Create checkout session ───────────────────────────────────

const createCheckout = async (tenantId, plan, successUrl, cancelUrl) => {
  const planConfig = PLANS[plan];
  if (!planConfig?.priceId) {
    throw Object.assign(new Error(`No Stripe price configured for plan: ${plan}`), { statusCode: 400, expose: true });
  }

  const customerId = await ensureStripeCustomer(tenantId);

  const session = await getStripe().checkout.sessions.create({
    customer:             customerId,
    mode:                 'subscription',
    payment_method_types: ['card'],
    line_items: [{
      price:    planConfig.priceId,
      quantity: 1,
    }],
    subscription_data: {
      metadata: { tenantId, plan },
      trial_period_days: 14,
    },
    success_url: successUrl || `${env.APP_URL}/billing?session_id={CHECKOUT_SESSION_ID}&status=success`,
    cancel_url:  cancelUrl  || `${env.APP_URL}/billing?status=cancelled`,
    allow_promotion_codes: true,
    metadata: { tenantId, plan },
  });

  logger.info({ tenantId, plan, sessionId: session.id }, 'Stripe checkout session created');
  return { checkoutUrl: session.url, sessionId: session.id };
};

// ── Create billing portal session ────────────────────────────

const createPortal = async (tenantId, returnUrl) => {
  const customerId = await ensureStripeCustomer(tenantId);
  const session = await getStripe().billingPortal.sessions.create({
    customer:   customerId,
    return_url: returnUrl || `${env.APP_URL}/billing`,
  });
  return { portalUrl: session.url };
};

// ── List invoices ─────────────────────────────────────────────

const listInvoices = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant.stripeCustomerId) return { invoices: [] };

  const invoices = await getStripe().invoices.list({
    customer: tenant.stripeCustomerId,
    limit:    10,
  });

  return {
    invoices: invoices.data.map(inv => ({
      id:          inv.id,
      number:      inv.number,
      status:      inv.status,
      amount:      inv.amount_paid / 100,
      currency:    inv.currency.toUpperCase(),
      period:      new Date(inv.period_end * 1000).toLocaleDateString('pt-BR'),
      pdfUrl:      inv.invoice_pdf,
      createdAt:   new Date(inv.created * 1000),
    })),
  };
};

// ── Cancel subscription ───────────────────────────────────────

const cancelSubscription = async (tenantId) => {
  const sub = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!sub?.stripeSubId) throw Object.assign(new Error('No active subscription'), { statusCode: 400, expose: true });

  // Cancel at period end (not immediately)
  await getStripe().subscriptions.update(sub.stripeSubId, {
    cancel_at_period_end: true,
  });

  logger.info({ tenantId }, 'Subscription set to cancel at period end');
  return { cancelledAtPeriodEnd: true, periodEnd: sub.currentPeriodEnd };
};

// ── Handle Stripe webhook events ─────────────────────────────

const handleWebhook = async (rawBody, signature) => {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error({ err: err.message }, 'Stripe webhook signature verification failed');
    throw Object.assign(new Error('Invalid webhook signature'), { statusCode: 400, expose: true });
  }

  logger.info({ type: event.type }, 'Stripe webhook received');

  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object;
      const { tenantId, plan } = session.metadata;
      if (!tenantId) break;

      await activatePlan(tenantId, plan, session.subscription);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenantId;
      if (!tenantId) break;

      await prisma.subscription.update({
        where: { tenantId },
        data: {
          status:             mapStripeStatus(sub.status),
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd:   new Date(sub.current_period_end   * 1000),
        },
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenantId;
      if (!tenantId) break;

      // Downgrade to free
      await prisma.subscription.update({
        where: { tenantId },
        data: {
          status:        'CANCELLED',
          plan:          'FREE',
          stripeSubId:   null,
          contactsLimit: PLANS.FREE.contactsLimit,
          aiTokensLimit: PLANS.FREE.aiTokensLimit,
          messagesLimit: PLANS.FREE.messagesLimit,
        },
      });

      await prisma.tenant.update({ where: { id: tenantId }, data: { plan: 'FREE' } });
      logger.warn({ tenantId }, 'Subscription cancelled — tenant downgraded to FREE');
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customer = await prisma.tenant.findFirst({
        where: { stripeCustomerId: invoice.customer },
      });
      if (customer) {
        await prisma.subscription.update({
          where: { tenantId: customer.id },
          data:  { status: 'PAST_DUE' },
        });
        logger.warn({ tenantId: customer.id }, 'Invoice payment failed — subscription past due');
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      if (invoice.billing_reason === 'subscription_cycle') {
        // Reset usage counters on renewal
        const customer = await prisma.tenant.findFirst({
          where: { stripeCustomerId: invoice.customer },
        });
        if (customer) {
          await prisma.subscription.update({
            where: { tenantId: customer.id },
            data:  { aiTokensUsed: 0n, messagesUsed: 0, status: 'ACTIVE' },
          });
          logger.info({ tenantId: customer.id }, 'Usage counters reset on subscription renewal');
        }
      }
      break;
    }

    default:
      logger.debug({ type: event.type }, 'Unhandled Stripe event');
  }

  return { received: true };
};

// ── Activate plan after successful payment ────────────────────

const activatePlan = async (tenantId, plan, stripeSubId) => {
  const planConfig = PLANS[plan] || PLANS.PRO;

  const stripeSub = await getStripe().subscriptions.retrieve(stripeSubId);

  await prisma.$transaction([
    prisma.subscription.upsert({
      where:  { tenantId },
      create: {
        tenantId,
        stripeSubId,
        plan:               plan,
        status:             'ACTIVE',
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
        currentPeriodEnd:   new Date(stripeSub.current_period_end   * 1000),
        contactsLimit:      planConfig.contactsLimit,
        aiTokensLimit:      planConfig.aiTokensLimit,
        messagesLimit:      planConfig.messagesLimit,
        aiTokensUsed:       0n,
        messagesUsed:       0,
      },
      update: {
        stripeSubId,
        plan:               plan,
        status:             'ACTIVE',
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
        currentPeriodEnd:   new Date(stripeSub.current_period_end   * 1000),
        contactsLimit:      planConfig.contactsLimit,
        aiTokensLimit:      planConfig.aiTokensLimit,
        messagesLimit:      planConfig.messagesLimit,
      },
    }),
    prisma.tenant.update({
      where: { id: tenantId },
      data:  { plan: plan },
    }),
  ]);

  logger.info({ tenantId, plan, stripeSubId }, 'Plan activated successfully');
};

// ── Plan limit enforcement middleware ─────────────────────────

const checkPlanLimits = async (tenantId, resource) => {
  const sub = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!sub) return;

  if (resource === 'contacts') {
    const count = await prisma.contact.count({ where: { tenantId } });
    if (count >= sub.contactsLimit) {
      throw Object.assign(
        new Error(`Contact limit reached (${count}/${sub.contactsLimit}). Upgrade your plan.`),
        { statusCode: 402, expose: true }
      );
    }
  }

  if (resource === 'ai_tokens') {
    if (sub.aiTokensUsed >= sub.aiTokensLimit) {
      throw Object.assign(
        new Error('AI token limit reached for this billing period. Upgrade your plan.'),
        { statusCode: 402, expose: true }
      );
    }
  }
};

const mapStripeStatus = (status) => {
  const map = { active:'ACTIVE', past_due:'PAST_DUE', canceled:'CANCELLED', trialing:'TRIALING' };
  return map[status] || 'ACTIVE';
};

module.exports = {
  getSubscription, createCheckout, createPortal,
  listInvoices, cancelSubscription, handleWebhook, checkPlanLimits,
};
