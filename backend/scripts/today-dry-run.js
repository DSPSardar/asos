#!/usr/bin/env node
// scripts/today-dry-run.js
//
// Prints Today's Queue for one tenant exactly as /today would show it —
// same selection service (needsYou), same viewer scoping — and optionally
// generates the AI draft for the first N in-window rows so the drafts can be
// judged before the page ships. Sends NOTHING. Drafts are cached in Redis
// under the same key the page uses, so nothing generated here is paid twice.
//
//   node scripts/today-dry-run.js --tenant <tenantId> [--drafts 5] [--json out.json]
//
// Phones are masked in the printout (last 4 digits only). The --json file
// keeps the masked form too — it is meant for sharing.
//
// Run from the Mac with the Railway CLI linked to the production project:
//   railway run -s asos -- node scripts/today-dry-run.js --tenant $MASTERY_TENANT_ID --drafts 5
// railway run injects the asos service variables; DATABASE_URL / REDIS_URL
// there point at *.railway.internal hosts, unreachable from outside Railway,
// so this script swaps them for the Postgres / Redis services' public URLs
// via `railway variables` before anything connects.

const { execSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : dflt; };
const TENANT_ID = opt('--tenant') || process.env.MASTERY_TENANT_ID;
const DRAFTS = parseInt(opt('--drafts', '0'), 10) || 0;
const JSON_OUT = opt('--json');

if (!TENANT_ID) {
  console.error('Usage: node scripts/today-dry-run.js --tenant <tenantId> [--drafts N] [--json file]');
  process.exit(1);
}

// Swap Railway-internal hosts for public ones (Mac-side runs only).
const publicVar = (service, name) => {
  try {
    const out = execSync(`railway variables --service ${service} --json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return JSON.parse(out)[name] || null;
  } catch { return null; }
};
if (/railway\.internal/.test(process.env.DATABASE_URL || '')) {
  const pub = publicVar('Postgres', 'DATABASE_PUBLIC_URL');
  if (pub) { process.env.DATABASE_URL = pub; console.error('• DATABASE_URL → Postgres public URL'); }
  else console.error('! DATABASE_URL is a railway.internal host and no DATABASE_PUBLIC_URL was found');
}
if (/railway\.internal/.test(process.env.REDIS_URL || '')) {
  const pub = publicVar('Redis', 'REDIS_PUBLIC_URL');
  if (pub) { process.env.REDIS_URL = pub; console.error('• REDIS_URL → Redis public URL'); }
  else { process.env.REDIS_URL = 'redis://127.0.0.1:6399'; console.error('! REDIS_URL unreachable from here — draft cache and skips disabled for this run'); }
}

require('dotenv').config();
const prisma = require('../src/config/database');
const { runWithSystemScope, requestContext } = require('../src/middleware/requestContext.middleware');
const needsYou = require('../src/services/needsYou.service');
const today = require('../src/modules/today/today.service');

const mask = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `${d.slice(0, 2)}…${d.slice(-4)}` : '—'; };
const wait = (h) => (h == null ? '' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`);
const TITLE = { needs_me: 'NEEDS YOU', unanswered: 'UNANSWERED', quiet: 'GONE QUIET', stalled: 'STALLED' };

(async () => {
  const now = new Date();
  const viewer = { userId: 'dry-run', role: 'TENANT_ADMIN' };
  const result = await runWithSystemScope(() => requestContext.run({ requestId: 'today-dry-run', tenantId: TENANT_ID }, async () => {
    const q = await needsYou.collectQueue(TENANT_ID, { viewer, now, includeSnoozed: true });
    const drafted = [];
    if (DRAFTS > 0) {
      const candidates = q.rows.filter((r) => r.insideWindow && r.reason !== 'payment_proof' && r.conversationId).slice(0, DRAFTS);
      for (const r of candidates) {
        try {
          const d = await today.getDraft(TENANT_ID, r.conversationId, viewer); // eslint-disable-line no-await-in-loop
          r.draft = d.draft; r.draftCached = d.cached;
          drafted.push(r.conversationId);
        } catch (err) { r.draftError = err.message; }
      }
    }
    return { ...q, drafted: drafted.length };
  }));

  console.log(`TODAY'S QUEUE — ${result.day} — ${result.total} row(s)` + (result.hidden ? ` (${result.hidden} skipped)` : ''));
  console.log(`counts: needs you ${result.counts.needs_me} · unanswered ${result.counts.unanswered} · gone quiet ${result.counts.quiet} · stalled ${result.counts.stalled}`);
  console.log(`context: AI handling ${result.context.handledByAi} conversations · ${result.context.inSequences} leads in sequences\n`);
  let group = null;
  result.rows.forEach((r, i) => {
    if (r.group !== group) { group = r.group; console.log(`── ${TITLE[group]} (${result.counts[group]}) ──`); }
    console.log(`${String(i + 1).padStart(2)}. ${r.name}  ${mask(r.phone)}  ${r.stage}  ${r.scoreLabel} ${r.aiScore}  waiting ${wait(r.hoursWaiting)}  ${r.insideWindow ? 'in-window' : 'OUTSIDE 24h'}${r.sequence ? `  [auto touch ${r.sequence.step}/${r.sequence.total}]` : ''}`);
    console.log(`    why: ${r.reason}${r.summary ? `\n    summary: ${r.summary}` : ''}`);
    if (r.lastMessage?.content) console.log(`    last (${r.lastMessage.direction === 'INBOUND' ? 'them' : r.lastMessage.sender}): ${r.lastMessage.content}`);
    if (r.draft) console.log(`    DRAFT${r.draftCached ? ' (cached)' : ''}: ${r.draft.replace(/\s+/g, ' ')}`);
    if (r.draftError) console.log(`    draft failed: ${r.draftError}`);
  });
  if (!result.rows.length) console.log('Nothing needs you today.');

  if (JSON_OUT) {
    const shareable = { ...result, rows: result.rows.map((r) => ({ ...r, phone: mask(r.phone) })) };
    fs.writeFileSync(JSON_OUT, JSON.stringify(shareable, null, 2));
    console.log(`\nwrote ${JSON_OUT}`);
  }
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('Dry run failed:', err.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
