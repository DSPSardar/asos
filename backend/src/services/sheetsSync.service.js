// src/services/sheetsSync.service.js
//
// Mirrors a tenant's leads into a Google Sheet.
//
// Design: the sheet is a full mirror, rewritten in one pass, rather than a
// stream of per-row edits. Row-level upserts would need stable row addressing
// in a document humans can sort and reorder at will — a rewrite is both simpler
// and impossible to leave half-applied.
//
// "Live" is therefore a coalesced rewrite: a lead change schedules a sync ~60s
// out under a per-tenant job id, so a burst of twenty leads produces one write
// instead of twenty. The hourly tick is the safety net that repairs anything a
// missed event would have dropped.

const prisma = require('../config/database');
const sheets = require('./googleSheets.service');
const { requestContext, runWithSystemScope } = require('../middleware/requestContext.middleware');
const logger = require('../utils/logger');

const TAB_NAME = 'Leads';
const SYNC_DEBOUNCE_MS = 60 * 1000;
// Ceiling per sync. Well past DSP's ~1.1k; guards against a runaway write.
const MAX_ROWS = 20000;

const HEADERS = [
  'Lead ID', 'Name', 'Phone', 'Email', 'Stage', 'Score', 'Source', 'Product',
  'Business Unit', 'Deal Value', 'Currency', 'Enrollment Fee', 'Owner',
  'Problem Summary', 'Created At', 'Updated At', 'Closed At',
];

const readConfig = (tenant) => {
  const settings = tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
  return settings.googleSheets || {};
};

const writeConfig = async (tenantId, patch) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const settings = tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
  const next = { ...settings, googleSheets: { ...(settings.googleSheets || {}), ...patch } };
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: next } });
  return next.googleSheets;
};

const sourceOf = (lead) => {
  const cf = lead.contact?.customFields;
  const raw = cf && typeof cf === 'object' && !Array.isArray(cf) ? cf.source : null;
  const utm = lead.sourceUtm && typeof lead.sourceUtm === 'object' ? lead.sourceUtm.source : null;
  return raw || utm || 'Other';
};

const iso = (d) => (d ? new Date(d).toISOString() : '');

const rowFor = (lead) => [
  lead.id,
  lead.contact?.name || '',
  lead.contact?.phone || '',
  lead.contact?.email || '',
  lead.stage || '',
  lead.scoreLabel || '',
  sourceOf(lead),
  lead.product || '',
  lead.businessUnit || '',
  lead.dealValue != null ? String(lead.dealValue) : '',
  lead.currency || '',
  lead.enrollmentFee != null ? String(lead.enrollmentFee) : '',
  lead.agent?.fullName || 'Unassigned',
  lead.problemSummary || '',
  iso(lead.createdAt),
  iso(lead.updatedAt),
  iso(lead.closedAt),
];

// Full rewrite for one tenant. Returns a result object rather than throwing on
// an expected failure (not configured, no sheet linked) so callers — the tick
// especially — can carry on to the next tenant.
const syncTenant = async (tenantId) => {
  if (!sheets.isConfigured()) {
    return { ok: false, skipped: true, reason: 'Google Sheets is not configured on the server' };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, settings: true },
  });
  if (!tenant) return { ok: false, skipped: true, reason: 'Tenant not found' };

  const config = readConfig(tenant);
  if (!config.enabled || !config.spreadsheetId) {
    return { ok: false, skipped: true, reason: 'No sheet connected' };
  }

  try {
    // Every query here is subject to row-level security, which reads the tenant
    // from the async request context. A scheduler job has no request, so
    // without this the policies match nothing, findMany returns zero rows, and
    // the "mirror" faithfully mirrors an empty database over a full sheet.
    const leads = await requestContext.run(
      { requestId: `sheets-sync:${tenantId}`, tenantId },
      () => prisma.lead.findMany({
        where: { tenantId },
        take: MAX_ROWS,
        orderBy: { createdAt: 'desc' },
        include: {
          contact: { select: { name: true, phone: true, email: true, customFields: true } },
          agent: { select: { fullName: true } },
        },
      })
    );

    // A full-mirror rewrite is only safe while the read is trustworthy. Zero
    // rows is far more likely to mean "the read was blocked" than "this tenant
    // genuinely has no leads", and the cost of guessing wrong is destroying the
    // customer's sheet. A tenant with no leads has nothing to write anyway, so
    // refusing to clear costs nothing and removes the failure mode entirely.
    if (leads.length === 0) {
      logger.warn({ tenantId }, 'Sheet sync read returned no leads — leaving the sheet untouched');
      await writeConfig(tenantId, {
        lastError: 'Sync skipped: the lead query returned no rows, so the sheet was left as it was.',
        lastErrorAt: new Date().toISOString(),
      }).catch(() => {});
      return { ok: false, skipped: true, reason: 'No leads readable' };
    }

    await sheets.ensureTab(config.spreadsheetId, TAB_NAME);
    const rows = [HEADERS, ...leads.map(rowFor)];
    await sheets.replaceTabContents(config.spreadsheetId, TAB_NAME, rows);

    await writeConfig(tenantId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncedRows: leads.length,
      lastError: null,
    });

    logger.info({ tenantId, rows: leads.length }, 'Google Sheet lead sync complete');
    return { ok: true, rows: leads.length };
  } catch (err) {
    // A tenant's sheet being unshared or deleted must not take the tick down;
    // record it against the tenant so Settings can show what went wrong.
    const message = err.response?.data?.error?.message || err.message;
    await writeConfig(tenantId, { lastError: message, lastErrorAt: new Date().toISOString() })
      .catch(() => {});
    logger.error({ err, tenantId }, 'Google Sheet lead sync failed');
    return { ok: false, error: message };
  }
};

// Every tenant with the integration switched on. Used by the hourly tick.
// System scope for the fan-out (reading across tenants), then syncTenant
// re-enters per-tenant scope for the rows themselves — the same shape the
// digest and automation ticks use.
const syncAllTenants = async () => runWithSystemScope(async () => {
  if (!sheets.isConfigured()) return { skipped: true };

  const tenants = await prisma.tenant.findMany({ select: { id: true, settings: true } });
  const targets = tenants.filter((t) => {
    const cfg = readConfig(t);
    return cfg.enabled && cfg.spreadsheetId;
  });

  let ok = 0;
  let failed = 0;
  for (const t of targets) {
    const res = await syncTenant(t.id);
    if (res.ok) ok += 1; else if (!res.skipped) failed += 1;
  }

  if (targets.length) logger.info({ ok, failed, total: targets.length }, 'Sheet sync tick complete');
  return { ok, failed, total: targets.length };
});

// Fire-and-forget nudge from the lead write paths. Never throws, never blocks a
// sale: the worst case is the row waits for the hourly tick.
const scheduleSync = (tenantId) => {
  if (!tenantId || !sheets.isConfigured()) return;
  try {
    // Required lazily — the queue module pulls in Redis, and this service is
    // also loaded by request handlers that must not depend on it at import time.
    const { schedulerQueue } = require('../queues/message.queue');
    schedulerQueue.add(
      'sheets-sync',
      { tenantId },
      {
        // One pending sync per tenant: a burst of lead changes coalesces into
        // a single rewrite instead of one per change. Hyphen, not colon —
        // BullMQ rejects a custom job id containing ":".
        jobId: `sheets-sync-${tenantId}`,
        delay: SYNC_DEBOUNCE_MS,
        removeOnComplete: 20,
        removeOnFail: 50,
      }
    ).catch((err) => logger.warn({ err, tenantId }, 'Could not schedule sheet sync'));
  } catch (err) {
    logger.warn({ err, tenantId }, 'Could not schedule sheet sync');
  }
};

module.exports = {
  TAB_NAME,
  HEADERS,
  syncTenant,
  syncAllTenants,
  scheduleSync,
  readConfig,
  writeConfig,
};
