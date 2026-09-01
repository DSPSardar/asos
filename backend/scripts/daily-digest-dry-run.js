#!/usr/bin/env node
// scripts/daily-digest-dry-run.js
//
// Builds the 09:00 daily digest for one tenant and prints the plain-text
// version. Sends NOTHING (no email, no WhatsApp), takes no once-a-day lock,
// and ignores the tenant's notifPrefs gate — it's for judging the content.
//
//   node scripts/daily-digest-dry-run.js --tenant <tenantId>
//   node scripts/daily-digest-dry-run.js --tenant <tenantId> --json   # counts + text as JSON
//
// Needs DATABASE_URL (and the rest of config/env) in the environment. Reads
// run under the tenant's own RLS context exactly as the scheduled job does.

require('dotenv').config();

const prisma = require('../src/config/database');
const { runWithSystemScope } = require('../src/middleware/requestContext.middleware');
const dailyDigest = require('../src/services/dailyDigest.service');

const args = process.argv.slice(2);
const tenantIdx = args.indexOf('--tenant');
const TENANT_ID = tenantIdx !== -1 ? args[tenantIdx + 1] : null;
const JSON_OUT = args.includes('--json');

if (!TENANT_ID) {
  console.error('Usage: node scripts/daily-digest-dry-run.js --tenant <tenantId> [--json]');
  process.exit(1);
}

(async () => {
  const result = await runWithSystemScope(() => dailyDigest.sendDailyDigest(TENANT_ID, { dryRun: true, force: true }));
  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.text) {
    console.log(result.text);
    console.log(`\n--- would go to ${result.recipients} email recipient(s)${result.whatsapp ? ' + WhatsApp' : ''}; empty=${result.empty}`);
  } else {
    console.log(JSON.stringify(result));
  }
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('Dry run failed:', err.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
