#!/usr/bin/env node
// scripts/create-superadmin.js
// Creates or updates a SUPERADMIN user with no tenant attachment.
// Run: node scripts/create-superadmin.js
// Or:  SUPERADMIN_EMAIL=you@example.com SUPERADMIN_PASS=secret123 node scripts/create-superadmin.js

const bcrypt = require('bcryptjs');

// ── Config — override with env vars ─────────────────────────────────────
const EMAIL    = process.env.SUPERADMIN_EMAIL || 'admin@asos.app';
const PASSWORD = process.env.SUPERADMIN_PASSWORD || 'Admin@ASOS2025';
const FULLNAME = process.env.SUPERADMIN_NAME    || 'Platform Admin';

async function main() {
  // Load prisma here so env is already set (avoids .env load order issues)
  const prisma = require('../src/config/database');

  const hash = await bcrypt.hash(PASSWORD, 12);

  const user = await prisma.user.upsert({
    where:  { email: EMAIL },
    create: {
      email:        EMAIL,
      passwordHash: hash,
      fullName:     FULLNAME,
      role:         'SUPERADMIN',
      tenantId:     null,    // SUPERADMIN has no tenant
      isActive:     true,
    },
    update: {
      passwordHash: hash,
      role:         'SUPERADMIN',
      isActive:     true,
    },
  });

  console.log(`\n✅ SUPERADMIN account ready:`);
  console.log(`   Email   : ${user.email}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`   Role    : ${user.role}`);
  console.log(`   ID      : ${user.id}\n`);
  console.log(`👉 Login at /auth and you will see the "Platform" section in the sidebar.\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('❌ Failed:', e.message);
  process.exit(1);
});
