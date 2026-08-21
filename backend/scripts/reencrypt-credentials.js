// scripts/reencrypt-credentials.js
// Run ONCE after setting ENCRYPTION_KEY: rewrites every stored encrypted
// credential (Tenant.waAccessToken / waAppSecret / metaAccessToken) from the
// legacy JWT_SECRET-derived key to the dedicated ENCRYPTION_KEY.
//
//   ENCRYPTION_KEY=... node scripts/reencrypt-credentials.js
//
// Safe to re-run: rows already on the new key are skipped. A credential that
// decrypts under neither key is reported and left untouched — it was already
// unreadable, and overwriting it would only destroy the evidence.

require('dotenv').config();

if (!process.env.ENCRYPTION_KEY) {
  console.error('ENCRYPTION_KEY is not set — nothing to re-encrypt to. Set it first.');
  process.exit(1);
}

const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt, isLegacyCiphertext } = require('../src/utils/crypto');

// Single session so the RLS system-scope below covers every query (this
// script touches all tenants' rows by design).
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL + (process.env.DATABASE_URL.includes('?') ? '&' : '?') + 'connection_limit=1' } },
});

const ENCRYPTED_COLUMNS = ['waAccessToken', 'waAppSecret', 'metaAccessToken'];

async function main() {
  await prisma.$executeRaw`SELECT set_config('app.rls_scope', 'system', FALSE)`;

  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, waAccessToken: true, waAppSecret: true, metaAccessToken: true },
  });

  let rewritten = 0, current = 0, unreadable = 0;

  for (const tenant of tenants) {
    const data = {};
    for (const col of ENCRYPTED_COLUMNS) {
      const stored = tenant[col];
      if (!stored) continue;
      if (!isLegacyCiphertext(stored)) { current += 1; continue; }
      const plain = decrypt(stored);
      if (plain === null) {
        unreadable += 1;
        console.error(`  ✗ ${tenant.slug} ${col}: decrypts under neither key — left untouched`);
        continue;
      }
      data[col] = encrypt(plain);
    }
    if (Object.keys(data).length > 0) {
      await prisma.tenant.update({ where: { id: tenant.id }, data });
      rewritten += Object.keys(data).length;
      console.log(`  ✓ ${tenant.slug}: re-encrypted ${Object.keys(data).join(', ')}`);
    }
  }

  console.log(`\nDone. ${rewritten} credential(s) re-encrypted, ${current} already on the new key, ${unreadable} unreadable.`);
  if (unreadable > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
