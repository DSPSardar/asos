#!/usr/bin/env node
// scripts/backlog-sweep.js — one-off backlog sweep (services/backlogSweep.service.js)
//
// For every thread on a tenant where the lead wrote last and nothing went
// out, generate the reply now (enrolled-student / payment-pending / sales,
// template outside the 24h window). Refund / legal / complaint / "talk to
// Sardar" threads are never answered — they stay flagged and raise one
// WhatsApp alert.
//
//   npm run backlog:sweep -- --dry-run                 # report only, sends NOTHING
//   npm run backlog:sweep -- --tenant <id> --dry-run
//   npm run backlog:sweep                              # real run (MASTERY_TENANT_ID)
//   options: --limit 150   --silent-minutes 30   --grace-hours 2   --json out.json
//
// Run from the Mac with the Railway CLI linked to production:
//   railway run -s asos -- npm run backlog:sweep -- --dry-run
// (see scripts/today-dry-run.js for the railway.internal → public URL swap).

const { execSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : dflt; };

const publicVar = (service, name) => {
  try {
    const out = execSync(`railway variables --service ${service} --json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return JSON.parse(out)[name] || null;
  } catch { return null; }
};
if (/railway\.internal/.test(process.env.DATABASE_URL || '')) {
  const pub = publicVar('Postgres', 'DATABASE_PUBLIC_URL');
  if (pub) { process.env.DATABASE_URL = pub; console.error('• DATABASE_URL → Postgres public URL'); }
}
if (/railway\.internal/.test(process.env.REDIS_URL || '')) {
  const pub = publicVar('Redis', 'REDIS_PUBLIC_URL');
  if (pub) { process.env.REDIS_URL = pub; console.error('• REDIS_URL → Redis public URL'); }
}

require('dotenv').config();
const env = require('../src/config/env');
const prisma = require('../src/config/database');
const redis = require('../src/config/redis');
const sweep = require('../src/services/backlogSweep.service');

const TENANT_ID = opt('--tenant') || env.MASTERY_TENANT_ID;
const dryRun = has('--dry-run');
if (!TENANT_ID) { console.error('Usage: node scripts/backlog-sweep.js --tenant <tenantId> [--dry-run]'); process.exit(1); }

const mask = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `${d.slice(0, 2)}…${d.slice(-4)}` : '—'; };

(async () => {
  console.error(`${dryRun ? '🔍 DRY RUN' : '🧹 LIVE RUN'} — tenant ${TENANT_ID}`);
  const summary = await sweep.sweepTenant(TENANT_ID, {
    dryRun,
    limit: parseInt(opt('--limit', '150'), 10) || 150,
    silentMinutes: parseInt(opt('--silent-minutes', String(sweep.SILENT_MINUTES)), 10),
    humanGraceHours: parseFloat(opt('--grace-hours', String(sweep.HUMAN_GRACE_HOURS))),
  });

  const line = (r) => `  ${r.name || '?'} (${mask(r.phone)}) [${r.stage || ''}] ${r.category || ''} → ${r.mode || r.reason}${r.template ? ` (${r.template})` : ''}`;
  console.log(`\nCandidates: ${summary.candidates}`);
  console.log(`Replied: ${summary.replied.total}  enrolled=${summary.replied.enrolled} payment_pending=${summary.replied.payment_pending} sales=${summary.replied.sales}`);
  console.log(`Templates: ${JSON.stringify(summary.templates)}`);
  console.log(`Skipped: ${JSON.stringify(summary.skipped)}`);
  console.log(`Flagged for a human (alerts ${summary.alerts}):`);
  summary.flagged.forEach((r) => console.log(line(r)));
  console.log('Replies:');
  summary.replies.forEach((r) => console.log(line(r)));
  console.log('Skipped threads:');
  summary.skippedThreads.forEach((r) => console.log(line(r)));

  const jsonOut = opt('--json');
  if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2)); console.error(`• wrote ${jsonOut}`); }

  await prisma.$disconnect().catch(() => {});
  await redis.quit().catch(() => {});
  process.exit(0);
})().catch(async (err) => {
  console.error('backlog sweep failed:', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
