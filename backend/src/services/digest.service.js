// src/services/digest.service.js
// Weekly Monday digest — pushes the /insights digest to each tenant's admins.
// Scheduled by the scheduler worker (Mon 09:00 Asia/Karachi).
//
// Email is the primary channel. WhatsApp is a best-effort nudge: Meta only
// allows free-form text inside a 24-hour customer-service window, so a
// proactive Monday morning push is usually outside it and gets rejected.
// That rejection is recorded, never thrown — an undelivered nudge must not
// fail the job or block the email that actually carries the digest.

const prisma = require('../config/database');
const logger = require('../utils/logger');
const { runWithSystemScope } = require('../middleware/requestContext.middleware');
const insightsService = require('../modules/insights/insights.service');
const whatsappService = require('./whatsapp.service');
const emailService = require('./email.service');
const env = require('../config/env');

const buildDigestText = (tenant, digest) => {
  const brand = tenant.name || 'ASOS';
  const lines = (digest.bullets || []).map((b) => `• ${b}`).join('\n');
  const body = lines || '• No classified activity in the last 7 days yet.';
  return `📊 *Weekly Digest — ${brand}*\n_Week to ${new Date().toISOString().slice(0, 10)}_\n\n${body}\n\nOpen the dashboard for the full breakdown.`;
};

// Send the digest for one tenant across every configured channel. Returns a
// result object rather than throwing so a single bad tenant — or a single
// dead channel — can't abort the whole weekly run.
//
// Email is the primary channel: no 24h window, no template approval, no
// length limit. WhatsApp is attempted as a best-effort nudge and is expected
// to fail outside Meta's customer-service window; that failure is recorded,
// not escalated.
const sendWeeklyDigest = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { tenantId, skipped: 'tenant_not_found' };

  const settings = tenant.settings || {};
  const adminPhone = settings.adminPhone;
  const pref = (settings.notifPrefs || {}).weeklyDigest || {};
  if (pref.enabled === false) return { tenantId, skipped: 'disabled' };

  // Recipients: an explicit digestEmail on the tenant, otherwise every active
  // admin on the account.
  let recipients = [];
  if (settings.digestEmail) {
    recipients = [settings.digestEmail];
  } else {
    const admins = await prisma.user.findMany({
      where: { tenantId, isActive: true, role: 'TENANT_ADMIN' },
      select: { email: true },
    });
    recipients = admins.map((a) => a.email).filter(Boolean);
  }

  if (recipients.length === 0 && !adminPhone) {
    return { tenantId, skipped: 'no_recipients' };
  }

  const digest = await insightsService.getDigest(tenantId);
  const bullets = digest.bullets || [];
  const result = { tenantId, email: { sent: 0, failed: 0 }, whatsapp: null };

  // ── Email (primary) ────────────────────────────────────────────────
  if (emailService.isDigestEmailConfigured()) {
    for (const to of recipients) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await emailService.sendDigestEmail({
          to,
          brandName: tenant.name || 'ASOS',
          bullets,
          dashboardUrl: env.APP_URL,
        });
        result.email.sent += 1;
      } catch (err) {
        result.email.failed += 1;
        logger.warn({ err, tenantId, to }, 'Digest email failed');
      }
    }
  } else {
    result.email.skipped = 'not_configured';
  }

  // ── WhatsApp (best-effort nudge) ───────────────────────────────────
  if (adminPhone && pref.whatsapp !== false) {
    try {
      await whatsappService.sendText(tenant, adminPhone, buildDigestText(tenant, digest));
      result.whatsapp = { sent: true };
    } catch (err) {
      // Expected outside Meta's 24h free-form window — not an error worth
      // paging anyone over while email carries the digest.
      result.whatsapp = { sent: false, error: String(err?.message || err).slice(0, 200) };
      logger.info({ tenantId, adminPhone }, 'Digest WhatsApp nudge not delivered (likely outside 24h window)');
    }
  }

  logger.info({ tenantId, ...result }, '📊 Weekly digest processed');
  return result;
};

// Cross-tenant weekly run. Reads across tenants, so it needs the explicit
// system scope (RLS would otherwise scope this to whatever tenant context the
// job inherited — none).
//
// Deliberately opt-in: only tenants that configured a digest destination
// (adminPhone or digestEmail) are included. Falling back to "every tenant
// with an admin user" would start mailing every trial signup on the platform
// a weekly report they never asked for.
const runWeeklyDigestForAllTenants = async () => runWithSystemScope(async () => {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, settings: true } });
  const targets = tenants.filter((t) => {
    const s = t.settings || {};
    return s.adminPhone || s.digestEmail;
  });

  logger.info({ tenantCount: targets.length }, '📊 Weekly digest run starting');

  const results = [];
  for (const t of targets) {
    // Sequential on purpose — this is a handful of tenants once a week, and
    // it keeps us well clear of WhatsApp send rate limits.
    // eslint-disable-next-line no-await-in-loop
    results.push(await sendWeeklyDigest(t.id));
  }

  const emailsSent = results.reduce((n, r) => n + (r.email?.sent || 0), 0);
  const emailsFailed = results.reduce((n, r) => n + (r.email?.failed || 0), 0);
  const waSent = results.filter((r) => r.whatsapp?.sent).length;
  const skipped = results.filter((r) => r.skipped).length;

  logger.info({ emailsSent, emailsFailed, waSent, skipped, tenants: results.length }, '📊 Weekly digest run finished');
  return { emailsSent, emailsFailed, waSent, skipped, tenants: results.length };
});

module.exports = { buildDigestText, sendWeeklyDigest, runWeeklyDigestForAllTenants };
