// scripts/import-students.js — one-time import of enrolled (paid) students.
//
// Usage:
//   railway run --service asos -- node scripts/import-students.js <csv> [--execute]
//
// Dry-run by default: prints what WOULD happen, writes nothing.
// CSV columns: name,phone,fee  (phone in any format; normalized to digits).
//
// For each student (matched to contacts by tenantId+phone):
//   - contact missing            -> create contact
//   - has a CLOSED_WON lead      -> set enrollmentFee/dealValue if missing
//   - has other leads            -> promote most recent lead to CLOSED_WON + fee
//   - has no leads               -> create a CLOSED_WON lead with fee
// Idempotent: re-running skips contacts already won-with-fee.

const fs = require('fs');

if (process.env.MIGRATION_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL; // owner conn, bypasses RLS
}
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CURRENCY = 'PKR';

function parseCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1);
  const rows = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:"([^"]*)"|([^,]*)),([^,]+),(\d+(?:\.\d+)?)\s*$/);
    if (!m) { console.warn('SKIP unparsable row:', line); continue; }
    const name  = (m[1] ?? m[2] ?? '').trim() || null;
    const phone = m[3].replace(/\D/g, '');
    const fee   = parseFloat(m[4]);
    if (phone.length < 8) { console.warn('SKIP bad phone:', line); continue; }
    rows.push({ name, phone, fee });
  }
  // dedupe by phone, keep first
  const seen = new Set();
  return rows.filter(r => !seen.has(r.phone) && seen.add(r.phone));
}

async function main() {
  const file    = process.argv[2];
  const execute = process.argv.includes('--execute');
  if (!file) { console.error('usage: node scripts/import-students.js <csv> [--execute]'); process.exit(1); }

  const tenant = await prisma.tenant.findFirst({ where: { name: { startsWith: 'DSP' } } });
  if (!tenant) throw new Error('DSP tenant not found');
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`Mode:   ${execute ? 'EXECUTE' : 'DRY RUN (no writes)'}\n`);

  const rows = parseCsv(file);
  console.log(`CSV: ${rows.length} unique students\n`);

  const stats = { contactCreated: 0, contactMatched: 0, feeAdded: 0, promoted: 0, leadCreated: 0, alreadyEnrolled: 0 };

  for (const r of rows) {
    let contact = await prisma.contact.findUnique({
      where: { tenantId_phone: { tenantId: tenant.id, phone: r.phone } },
      include: { leads: { orderBy: { createdAt: 'desc' } } },
    });

    if (!contact) {
      stats.contactCreated++;
      if (execute) {
        contact = await prisma.contact.create({
          data: { tenantId: tenant.id, phone: r.phone, name: r.name, optIn: true },
        });
        contact.leads = [];
      } else { contact = { leads: [] }; }
    } else {
      stats.contactMatched++;
      if (execute && r.name && !contact.name) {
        await prisma.contact.update({ where: { id: contact.id }, data: { name: r.name } });
      }
    }

    const fee  = r.fee;
    const won  = contact.leads.filter(l => l.stage === 'CLOSED_WON');
    const paid = won.find(l => l.enrollmentFee != null || l.dealValue != null);

    if (paid) { stats.alreadyEnrolled++; continue; }

    if (won.length) {
      stats.feeAdded++;
      if (execute) await prisma.lead.update({
        where: { id: won[0].id },
        data: { enrollmentFee: fee, dealValue: fee, currency: CURRENCY,
                closedAt: won[0].closedAt || new Date() },
      });
    } else if (contact.leads.length) {
      stats.promoted++;
      if (execute) await prisma.lead.update({
        where: { id: contact.leads[0].id },
        data: { stage: 'CLOSED_WON', enrollmentFee: fee, dealValue: fee,
                currency: CURRENCY, closedAt: new Date() },
      });
    } else {
      stats.leadCreated++;
      if (execute) await prisma.lead.create({
        data: { tenantId: tenant.id, contactId: contact.id, stage: 'CLOSED_WON',
                enrollmentFee: fee, dealValue: fee, currency: CURRENCY,
                closedAt: new Date(), scoreLabel: 'HOT', aiScore: 100 },
      });
    }
  }

  console.log('Summary:', JSON.stringify(stats, null, 2));
  const total = stats.feeAdded + stats.promoted + stats.leadCreated + stats.alreadyEnrolled;
  console.log(`\nEnrolled after ${execute ? 'this run' : 'execution would be'}: ${total}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
