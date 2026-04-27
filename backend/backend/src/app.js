// src/app.js
// Express application factory

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const logger = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/error.middleware');

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
const billingRoutes      = require('./modules/billing/billing.routes');
const adminRoutes        = require('./modules/admin/admin.routes');
const webhookRoutes      = require('./webhooks/webhook.routes');

const createApp = () => {
  const app = express();

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

  // Webhooks need raw body for signature verification
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

  // ── Strict rate limit for auth
  app.use('/api/v1/auth', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many auth attempts.' },
  }));

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
  app.use(`${v1}/billing`,        billingRoutes);
  app.use(`${v1}/admin`,          adminRoutes);
  app.use('/webhooks',            webhookRoutes);

  // ── 404 + Error handlers (must be last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
