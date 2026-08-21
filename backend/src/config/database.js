// src/config/database.js
// Prisma client singleton, extended to enforce Postgres row-level security.
//
// Every model query is wrapped in a short transaction that first calls
// set_config('app.current_tenant_id', <tenant>, TRUE) — transaction-local, so
// nothing leaks across pooled connections — with the tenant read from the
// AsyncLocalStorage that auth.middleware.js / conversation.worker.js populate
// from *verified* sources (JWT-backed DB row, HMAC-verified webhook mapping).
// The RLS policies in prisma/migrations/*_enable_rls deny every row on the 16
// tenant-scoped tables unless that setting matches the row's tenant_id, or
// app.rls_scope = 'system' (the explicit SUPERADMIN/ops path).
//
// Fail-closed on purpose: a query issued with no tenant context sees zero
// rows on RLS tables. A future query that forgets its tenantId filter can no
// longer read another tenant's data — Postgres refuses, regardless of what
// the JavaScript says. `tenants` and `users` are deliberately exempt (they
// are the identity roots consulted *before* tenant context can exist: login
// by email, webhook phone-id lookup) — see the migration for the full list.
const { PrismaClient } = require('@prisma/client');
const env = require('./env');
const { getRequestContext } = require('../middleware/requestContext.middleware');

const base = new PrismaClient({
  log: env.NODE_ENV === 'development'
    ? ['query', 'info', 'warn', 'error']
    : ['warn', 'error'],
  errorFormat: 'pretty',
});

const rlsValues = () => {
  const { tenantId, rlsScope } = getRequestContext();
  // set_config rejects NULL; empty string never matches a tenant_id and
  // never equals 'system', so "no context" stays a denial, not an error.
  return [tenantId || '', rlsScope || ''];
};

// `prisma` is assigned below; the extension closes over it so the batch
// $transaction used here is the extended client's own (Prisma supports
// query(args) inside a batch — this is the documented RLS extension pattern).
let prisma;

const xprisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const [tenantId, rlsScope] = rlsValues();
        const [, result] = await prisma.$transaction([
          prisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE), set_config('app.rls_scope', ${rlsScope}, TRUE)`,
          query(args),
        ]);
        return result;
      },
    },
  },
});
prisma = xprisma;

// Interactive $transaction with the RLS context applied once at the start,
// so every statement inside runs under the caller's tenant. The batch
// (array) form is rejected: its elements are extended-client promises that
// would each self-wrap in their *own* transaction when awaited — silently
// losing atomicity, which is worse than failing loudly here.
//
// Registration-style flows that create a tenant *inside* the transaction
// re-issue set_config themselves once the new tenant id exists — see
// auth.service.js.
const rlsTransaction = (arg, opts) => {
  if (typeof arg !== 'function') {
    throw new Error(
      'Batch (array) $transaction is not RLS-safe — use the interactive form: prisma.$transaction(async (tx) => { ... })'
    );
  }
  return base.$transaction(async (tx) => {
    const [tenantId, rlsScope] = rlsValues();
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE), set_config('app.rls_scope', ${rlsScope}, TRUE)`;
    return arg(tx);
  }, opts);
};

// RLS is only enforced for roles without superuser/BYPASSRLS — Railway's
// default postgres user is a superuser and silently bypasses every policy,
// turning the entire tenant-isolation layer into decoration. Swapping
// DATABASE_URL to the asos_app role (scripts/create-app-role.sql) is a
// manual step, so verify it actually happened: in production, refuse to
// serve traffic on a bypassing role; elsewhere, warn loudly.
// Uses base.$queryRaw deliberately — pg_roles is not RLS-scoped and the
// extension only wraps model operations anyway.
const assertRlsEnforceable = async ({ logger, fatal }) => {
  const rows = await base.$queryRaw`
    SELECT rolsuper AS "rolsuper", rolbypassrls AS "rolbypassrls"
    FROM pg_roles WHERE rolname = current_user
  `;
  const role = rows?.[0];
  const bypasses = !role || role.rolsuper || role.rolbypassrls;

  if (!bypasses) return true;

  const msg =
    'Database role bypasses row-level security (superuser or BYPASSRLS) — ' +
    'tenant isolation policies are NOT being enforced. Run ' +
    'scripts/create-app-role.sql and point DATABASE_URL at asos_app.';

  if (fatal) {
    logger.fatal({ role }, msg);
    return false;
  }
  logger.warn({ role }, msg);
  return true;
};

// Graceful shutdown
process.on('beforeExit', async () => {
  await base.$disconnect();
});

module.exports = new Proxy(xprisma, {
  get(target, prop, receiver) {
    if (prop === '$transaction') return rlsTransaction;
    if (prop === 'assertRlsEnforceable') return assertRlsEnforceable;
    return Reflect.get(target, prop, receiver);
  },
});
