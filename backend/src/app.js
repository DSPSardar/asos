// src/app.js
// Express application factory

// Prisma _count fields can return BigInt — patch before any JSON serialisation
BigInt.prototype.toJSON = function () { return Number(this); };

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const Sentry = require('@sentry/node');
const env = require('./config/env');
const logger = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/error.middleware');
const { requestContextMiddleware, runWithSystemScope } = require('./middleware/requestContext.middleware');
const prisma = require('./config/database');

// Route modules
const authRoutes         = require('./modules/auth/auth.routes');
const leadsRoutes        = require('./modules/leads/leads.routes');
const contactsRoutes     = require('./modules/contacts/contacts.routes');
const conversationsRoutes = require('./modules/conversations/conversations.routes');
const campaignsRoutes    = require('./modules/campaigns/campaigns.routes');
const analyticsRoutes    = require('./modules/analytics/analytics.routes');
const usersRoutes        = require('./modules/users/users.routes');
const settingsRoutes     = require('./modules/settings/settings.routes');
const aiConfigRoutes     = require('./modules/ai-config/aiConfig.routes');
const knowledgeGapsRoutes = require('./modules/knowledge-gaps/knowledge-gaps.routes');
const billingRoutes      = require('./modules/billing/billing.routes');
const adminRoutes        = require('./modules/admin/admin.routes');
const contentStudioRoutes = require('./modules/content-studio/content-studio.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const webhookRoutes      = require('./webhooks/webhook.routes');
const twilioVoiceWebhook = require('./webhooks/twilio.webhook');
// Dev-only routes: inject fake inbound WhatsApp messages into any tenant's
// pipeline by tenantId, and list every tenant's id to make that easy.
// Historically gated on WHATSAPP_MOCK=true alone, with no NODE_ENV check and
// no authentication on the routes themselves — a single accidentally-flipped
// env var in production would have exposed tenant enumeration and message
// injection to anyone, unauthenticated. NODE_ENV is now checked here as the
// primary gate (a dev tool must never be reachable in production, full stop,
// regardless of any other flag); dev.routes.js also now requires a valid
// session as defense-in-depth, in case this file is ever mounted somewhere
// NODE_ENV isn't 'production' but is still reachable by more than the
// developer running it locally (e.g. a shared staging environment).
const devRoutes = (env.WHATSAPP_MOCK === 'true' && env.NODE_ENV !== 'production')
  ? require('./modules/dev/dev.routes')
  : null;

if (env.WHATSAPP_MOCK === 'true' && env.NODE_ENV === 'production') {
  logger.error(
    'WHATSAPP_MOCK=true is set in a production environment — dev routes were ' +
    'NOT mounted (NODE_ENV gate), but this variable should not be set here. ' +
    'Unset WHATSAPP_MOCK in this environment\'s variables.'
  );
}

const createApp = () => {
  const app = express();

  // Trust Apache/Nginx reverse proxy so X-Forwarded-For is used for rate limiting
  app.set('trust proxy', 1);

  // Mounted before everything else so every log line for this request —
  // including a CORS rejection or a rate-limit block below — carries the
  // same requestId. See requestContext.middleware.js and utils/logger.js.
  app.use(requestContextMiddleware);

  // ── Security headers
  app.use(helmet());

  // ── CORS
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));

  // ── Body parsing (raw body preserved for webhook HMAC verification)
  app.use('/api', express.json({ limit: '10mb' }));
  app.use('/api', express.urlencoded({ extended: true }));

  // Twilio voice webhooks submit form data. Mount these before the raw-body
  // middleware used by Meta and Stripe signature verification.
  app.use('/webhooks/twilio', express.urlencoded({ extended: false }), twilioVoiceWebhook);

  // Meta and Stripe webhooks need the original raw body for signature verification.
  app.use('/webhooks', express.raw({ type: '*/*', limit: '5mb' }));

  // ── HTTP request logging
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim(), 'http') },
    skip: (req) => req.url === '/health',
  }));

  // ── Global rate limiter
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 min
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' },
  }));

  // ── Strict rate limit only for login/register/password-reset (brute-force targets)
  // /auth/me and /auth/refresh are excluded — they fire on every page load
  const strictAuthPaths = [
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/google',
    '/api/v1/auth/forgot-password',
    '/api/v1/auth/reset-password',
  ];
  app.use(strictAuthPaths, rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many auth attempts, please try again later.' },
  }));

  // ── Webhook rate limiter
  // /webhooks is mounted outside /api, so the global limiter above never
  // applied to it — these endpoints had no rate limiting at all. They are
  // unauthenticated by design (Meta, Stripe and Twilio call them), and each
  // request costs real work: HMAC computation, a tenant lookup, and for
  // WhatsApp a queued job that spends OpenAI credits.
  //
  // The ceiling is high because Meta legitimately bursts and retries — this
  // is a floodgate, not a throttle on normal traffic. Signature verification
  // remains the actual authentication; see whatsapp.webhook.js.
  app.use('/webhooks', rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many webhook requests.' },
  }));

  // ── Serve uploaded files (content images, reports, etc.)
  // In production nginx serves /uploads/ directly from the shared Docker volume.
  // This static middleware covers dev and acts as a fallback.
  const uploadsPath = require('path').resolve(process.cwd(), 'uploads');
  app.use('/uploads', (req, res, next) => {
    // Same Helmet CORP fix as /media/:id below — this mount predates that
    // route and has the identical latent bug for any content-studio image
    // ever embedded cross-subdomain from the dashboard.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }, express.static(uploadsPath, { maxAge: '365d', immutable: true }));

  // ── Serve inbound WhatsApp media (stored in Postgres, not local disk)
  // See InboundMedia in schema.prisma and saveInboundMedia() in
  // whatsapp.service.js for why: the container that downloads this media
  // (asos-worker) and the one serving it (this service) don't share a
  // filesystem, so the bytes live in the one place both can reach.
  //
  // Deliberately unauthenticated, matching the /uploads mount above — an
  // <img src="..."> tag in the dashboard can't attach an Authorization
  // header, so this can only ever be as protected as the id is hard to
  // guess (a random UUID), the same model /uploads/inbound-media/<tenant>/
  // <uuid>.<ext> already used. runWithSystemScope is required here because
  // there is no authenticated tenant on this request for Postgres RLS to
  // key off of — see requestContext.middleware.js.
  app.get('/media/:id', async (req, res) => {
    try {
      const row = await runWithSystemScope(() =>
        prisma.inboundMedia.findUnique({
          where: { id: req.params.id },
          select: { data: true, mimeType: true },
        })
      );
      if (!row) return res.status(404).json({ success: false, message: 'Not found' });

      // Helmet's default Cross-Origin-Resource-Policy: same-origin blocks
      // this from loading as an <img> from the dashboard's origin (a
      // different subdomain than the API) even though the response itself
      // is fine — CORP is enforced by the browser independently of the CORS
      // allow-list above, and direct navigation to the URL doesn't exercise
      // it at all, which is exactly why this slipped through manual
      // testing the first time. Explicitly widen it for this one route
      // rather than turning it off app-wide.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(row.data);
    } catch (err) {
      logger.warn({ err: err.message, mediaId: req.params.id }, 'Failed to serve inbound media');
      res.status(500).json({ success: false, message: 'Failed to load media' });
    }
  });

  // ── Health check
  app.get('/health', (req, res) => res.json({
    status: 'ok',
    service: 'asos-api',
    version: env.API_VERSION,
    timestamp: new Date().toISOString(),
  }));

  // ── Routes
  const v1 = `/api/${env.API_VERSION}`;
  app.use(`${v1}/auth`,           authRoutes);
  app.use(`${v1}/leads`,          leadsRoutes);
  app.use(`${v1}/contacts`,       contactsRoutes);
  app.use(`${v1}/conversations`,  conversationsRoutes);
  app.use(`${v1}/campaigns`,      campaignsRoutes);
  app.use(`${v1}/analytics`,      analyticsRoutes);
  app.use(`${v1}/users`,          usersRoutes);
  app.use(`${v1}/settings`,       settingsRoutes);
  app.use(`${v1}/ai`,             aiConfigRoutes);
  app.use(`${v1}/ai/knowledge-gaps`, knowledgeGapsRoutes);
  app.use(`${v1}/billing`,        billingRoutes);
  app.use(`${v1}/admin`,          adminRoutes);
  app.use(`${v1}/content-studio`, contentStudioRoutes);
  app.use(`${v1}/reports`,        reportsRoutes);
  if (devRoutes) {
    app.use(`${v1}/dev`,          devRoutes);
    logger.warn('[MOCK MODE] Dev routes mounted at /api/v1/dev — WHATSAPP_MOCK=true');
  }
  app.use('/webhooks',            webhookRoutes);

  // ── 404 + Error handlers (must be last)
  app.use(notFound);

  // Sentry's handler must sit between notFound and the app's own
  // errorHandler: it inspects/reports whatever reaches it via next(err),
  // then calls next(err) itself so errorHandler below still runs unchanged
  // and shapes the JSON response exactly as before — this only adds
  // reporting, nothing about the response changes.
  //
  // shouldHandleError excludes routine 4xx the app throws on purpose
  // (bad credentials, "lead not found" after a tenant check, validation
  // errors — anything with `expose: true` and a sub-500 statusCode). Kept
  // in sync with instrument.js's beforeSend, which applies the same rule
  // for errors this handler never even sees (e.g. from outside Express's
  // own middleware chain). Without this, Sentry would open a new "issue"
  // for every mistyped password — that is not what an error tracker is for,
  // and it would drown out the incidents actually worth looking at.
  Sentry.setupExpressErrorHandler(app, {
    shouldHandleError(error) {
      return !(error?.expose && Number(error?.statusCode) < 500);
    },
  });

  app.use(errorHandler);

  return app;
};

module.exports = createApp;
