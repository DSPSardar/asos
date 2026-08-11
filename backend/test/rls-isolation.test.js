// test/rls-isolation.test.js
//
// Proves tenant isolation at the DATABASE layer, underneath the application.
// tenant-isolation.test.js shows the HTTP surface returns 404s; this file
// shows something stronger: even a structurally wrong query — findUnique by
// bare id, findMany with no where, update by id, all with NO tenantId filter
// in the JavaScript — cannot touch another tenant's rows, because Postgres
// row-level security refuses at the row level. This is what moves the
// council's "no evidence of tenant-level data separation" to verified: the
// separation holds even against code that forgets to scope.
//
// Requires a real, disposable Postgres with migrations applied
// (`npx prisma migrate deploy`), including 20260811120000_enable_row_level_security.
//
// Run: DATABASE_URL=postgresql://... node --test test/rls-isolation.test.js
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required — point it at a disposable test Postgres.');
  process.exit(1);
}
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-at-least-32-chars';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'z'.repeat(64);
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

// Two roles, deliberately:
//
//   ADMIN_URL (the DATABASE_URL passed in)  — used only for fixtures and for
//   creating the app role. In this local harness it is the initdb superuser.
//
//   APP_URL — a dedicated NOSUPERUSER role ('asos_app') created in before().
//   Postgres SUPERUSERS BYPASS ROW-LEVEL SECURITY ENTIRELY (FORCE or not),
//   so running the app client as the superuser makes every test below pass
//   vacuously while proving nothing. This bit us on the first run of this
//   file: all isolation "passed" until the update test actually mutated the
//   other tenant's row. The same applies in production — RLS is only real
//   once the asos/asos-worker DATABASE_URL is a non-superuser role.
const ADMIN_URL = process.env.DATABASE_URL;
const appUrl = new URL(ADMIN_URL);
appUrl.username = 'asos_app';
appUrl.password = 'asos_app_test_pw';
const APP_URL = appUrl.toString();

// The app client (src/config/database.js) reads env.DATABASE_URL when
// required — point it at the non-superuser role BEFORE the require below.
// Prisma connects lazily, so the role only has to exist by the first query.
process.env.DATABASE_URL = APP_URL;

// Fixture client: raw Prisma on a single connection with the session-level
// system scope, so it can create/inspect both tenants' rows. This mimics a
// trusted operator, NOT the application path.
const { PrismaClient } = require('@prisma/client');
const fixtures = new PrismaClient({
  datasources: { db: { url: ADMIN_URL + (ADMIN_URL.includes('?') ? '&' : '?') + 'connection_limit=1' } },
});

// Application client: the real src/config/database.js the API and worker
// use, with tenant context supplied the same way auth.middleware.js and the
// worker supply it — via AsyncLocalStorage.
const prisma = require('../src/config/database');
const { requestContext } = require('../src/middleware/requestContext.middleware');

// The `async () => fn()` wrapper is load-bearing, not style: PrismaPromises
// are lazy, and the RLS extension reads the ALS store when the promise is
// AWAITED. `run(store, fn)` with fn returning the promise directly would
// await it OUTSIDE the context — the store reads as empty and every query
// fails closed, which shows up as the two "allowed" tests failing while all
// the denial tests pass vacuously (exactly what happened before this
// comment existed). Application code always awaits inline inside the
// request/job context, so it never hits this; test helpers must match.
const asTenant = (tenantId, fn) => requestContext.run({ requestId: 'rls-test', tenantId }, async () => fn());
const asSystem = (fn) => requestContext.run({ requestId: 'rls-test', rlsScope: 'system' }, async () => fn());
const asNobody = (fn) => fn(); // no ALS context at all — e.g. a stray script

let tenantA, tenantB, leadA, leadB, contactB, convB, msgB;

before(async () => {
  // Create the non-superuser application role the app client connects as —
  // the same shape production needs (see scripts/create-app-role.sql).
  await fixtures.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'asos_app') THEN
        CREATE ROLE asos_app LOGIN PASSWORD 'asos_app_test_pw' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
  `);
  await fixtures.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO asos_app`);
  await fixtures.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO asos_app`);
  await fixtures.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO asos_app`);

  await fixtures.$executeRaw`SELECT set_config('app.rls_scope', 'system', FALSE)`;

  const stamp = Date.now();
  tenantA = await fixtures.tenant.create({ data: { slug: `rls-a-${stamp}`, name: 'RLS A', status: 'ACTIVE' } });
  tenantB = await fixtures.tenant.create({ data: { slug: `rls-b-${stamp}`, name: 'RLS B', status: 'ACTIVE' } });

  const contactA = await fixtures.contact.create({ data: { tenantId: tenantA.id, name: 'A', phone: `92310${stamp}`.slice(0, 15) } });
  contactB = await fixtures.contact.create({ data: { tenantId: tenantB.id, name: 'B SECRET', phone: `92311${stamp}`.slice(0, 15) } });

  leadA = await fixtures.lead.create({ data: { tenantId: tenantA.id, contactId: contactA.id, stage: 'NEW' } });
  leadB = await fixtures.lead.create({ data: { tenantId: tenantB.id, contactId: contactB.id, stage: 'NEW' } });

  convB = await fixtures.conversation.create({ data: { tenantId: tenantB.id, leadId: leadB.id, contactId: contactB.id, status: 'AI_HANDLING' } });
  msgB = await fixtures.message.create({ data: { tenantId: tenantB.id, conversationId: convB.id, direction: 'INBOUND', sender: 'CONTACT', type: 'TEXT', content: 'RLS B SECRET CONTENT', status: 'PENDING' } });
});

after(async () => {
  await fixtures.$disconnect();
  await prisma.$disconnect();
});

// ── The core claim: a bare-id read with no tenant filter cannot cross ──

test('findUnique by bare id (no tenantId in the where) cannot see the other tenant\'s lead', async () => {
  const got = await asTenant(tenantA.id, () => prisma.lead.findUnique({ where: { id: leadB.id } }));
  assert.equal(got, null, 'RLS failed: tenant A read tenant B\'s lead by direct id');
});

test('findUnique by bare id still works for the caller\'s OWN rows', async () => {
  const got = await asTenant(tenantA.id, () => prisma.lead.findUnique({ where: { id: leadA.id } }));
  assert.ok(got, 'tenant A could not read its own lead — RLS context is broken, not just strict');
  assert.equal(got.id, leadA.id);
});

test('conversation and message reads by bare id cannot cross tenants', async () => {
  const conv = await asTenant(tenantA.id, () => prisma.conversation.findUnique({ where: { id: convB.id } }));
  const msg = await asTenant(tenantA.id, () => prisma.message.findFirst({ where: { id: msgB.id } }));
  assert.equal(conv, null, 'tenant A read tenant B\'s conversation by id');
  assert.equal(msg, null, 'tenant A read tenant B\'s message by id');
});

test('a filter-less findMany/count only sees the caller\'s tenant', async () => {
  const [leads, n] = await asTenant(tenantA.id, () => Promise.all([
    prisma.lead.findMany({}),
    prisma.lead.count(),
  ]));
  assert.ok(leads.every((l) => l.tenantId === tenantA.id), 'foreign lead leaked into unscoped findMany');
  assert.ok(leads.some((l) => l.id === leadA.id), 'own lead missing from unscoped findMany');
  assert.equal(n, leads.length);
});

test('update/delete by bare id cannot mutate the other tenant\'s rows', async () => {
  await assert.rejects(
    asTenant(tenantA.id, () => prisma.lead.update({ where: { id: leadB.id }, data: { stage: 'CLOSED_WON' } })),
    /not found|No record was found/i,
    'update crossed the tenant boundary'
  );
  await assert.rejects(
    asTenant(tenantA.id, () => prisma.lead.delete({ where: { id: leadB.id } })),
    /not found|No record was found/i,
    'delete crossed the tenant boundary'
  );
  const still = await fixtures.lead.findUnique({ where: { id: leadB.id } });
  assert.equal(still.stage, 'NEW', 'tenant B\'s lead was mutated across the boundary');
});

test('inserting a row claiming the other tenant\'s id is refused (WITH CHECK)', async () => {
  await assert.rejects(
    asTenant(tenantA.id, () => prisma.contact.create({
      data: { tenantId: tenantB.id, name: 'forged', phone: `92399${Date.now()}`.slice(0, 15) },
    })),
    'insert with a foreign tenant_id was accepted'
  );
  const forged = await fixtures.contact.findFirst({ where: { tenantId: tenantB.id, name: 'forged' } });
  assert.equal(forged, null, 'forged contact row exists despite rejection');
});

test('no tenant context at all sees zero rows (fail closed)', async () => {
  const leads = await asNobody(() => prisma.lead.findMany({}));
  assert.equal(leads.length, 0, 'context-less query saw tenant rows — RLS is not failing closed');
});

test('system scope (the audited SUPERADMIN/ops path) sees both tenants', async () => {
  const leads = await asSystem(() => prisma.lead.findMany({ where: { id: { in: [leadA.id, leadB.id] } } }));
  assert.equal(leads.length, 2, 'system scope should see both tenants\' rows');
});

test('interactive $transaction carries the caller\'s tenant context', async () => {
  const got = await asTenant(tenantA.id, () => prisma.$transaction(async (tx) => {
    const own = await tx.lead.findUnique({ where: { id: leadA.id } });
    const foreign = await tx.lead.findUnique({ where: { id: leadB.id } });
    return { own, foreign };
  }));
  assert.ok(got.own, 'own row invisible inside transaction');
  assert.equal(got.foreign, null, 'foreign row visible inside transaction');
});

test('batch (array) $transaction is rejected as not RLS-safe', () => {
  assert.throws(
    () => prisma.$transaction([]),
    /not RLS-safe/,
    'batch $transaction should be refused — it would silently lose atomicity under the RLS wrapper'
  );
});
