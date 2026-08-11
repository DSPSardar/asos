// test/tenant-isolation.test.js
//
// Proves tenant isolation from the outside: real HTTP requests against the
// real Express app and a real Postgres database, with two genuinely separate
// tenants. Does not import service internals — the whole point is to test
// what an attacker with tenant A's JWT can actually reach over the wire,
// which is a different (and stricter) question than "does the code call
// findFirst with the right where clause."
//
// This exists because tenant isolation in this codebase is enforced entirely
// by application-layer convention — there is no Postgres row-level security,
// no Prisma middleware that auto-scopes queries. Nothing stops a future
// query from omitting tenantId. This test is the guardrail: it fails loudly
// if that ever happens for the endpoints it covers.
//
// Requires a real, disposable Postgres — DATABASE_URL must point at one with
// migrations applied (`npx prisma migrate deploy`). Never point this at a
// database with real data; it creates and deletes rows.
//
// Run: DATABASE_URL=postgresql://... node --test test/tenant-isolation.test.js
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

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
process.env.PORT = '0';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

let server, port;
const authHeader = (user) => 'Bearer ' + jwt.sign(
  { userId: user.id, sub: user.id, tenantId: user.tenantId, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

const request = (method, path, token, body) => new Promise((resolve) => {
  const payload = body ? JSON.stringify(body) : null;
  const req = http.request({
    host: '127.0.0.1', port, method, path: '/api/v1' + path,
    headers: {
      ...(token ? { Authorization: token } : {}),
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  }, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(raw); } catch { /* non-JSON response, leave null */ }
      resolve({ status: res.statusCode, body: json, raw });
    });
  });
  req.on('error', (e) => resolve({ status: 0, body: null, raw: e.message }));
  if (payload) req.write(payload);
  req.end();
});

// Two fully separate tenants, each with their own admin user, contact, lead,
// and conversation — the fixtures a real attack would target.
let tenantA, tenantB, userA, userB, leadA, leadB, contactA, contactB, convA, convB;

before(async () => {
  const app = require('../src/app');
  const instance = typeof app === 'function' ? app() : app;
  server = instance.listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;

  const stamp = Date.now();
  tenantA = await prisma.tenant.create({ data: { slug: `tenant-a-${stamp}`, name: 'Tenant A', status: 'ACTIVE' } });
  tenantB = await prisma.tenant.create({ data: { slug: `tenant-b-${stamp}`, name: 'Tenant B', status: 'ACTIVE' } });

  userA = await prisma.user.create({ data: { tenantId: tenantA.id, email: `a${stamp}@test.local`, passwordHash: 'x', fullName: 'A Admin', role: 'TENANT_ADMIN' } });
  userB = await prisma.user.create({ data: { tenantId: tenantB.id, email: `b${stamp}@test.local`, passwordHash: 'x', fullName: 'B Admin', role: 'TENANT_ADMIN' } });

  contactA = await prisma.contact.create({ data: { tenantId: tenantA.id, name: 'A Contact', phone: `92300${stamp}A`.slice(0, 15) } });
  contactB = await prisma.contact.create({ data: { tenantId: tenantB.id, name: 'B Contact — SECRET', phone: `92301${stamp}B`.slice(0, 15) } });

  leadA = await prisma.lead.create({ data: { tenantId: tenantA.id, contactId: contactA.id, stage: 'NEW' } });
  leadB = await prisma.lead.create({ data: { tenantId: tenantB.id, contactId: contactB.id, stage: 'NEW' } });

  convA = await prisma.conversation.create({ data: { tenantId: tenantA.id, leadId: leadA.id, contactId: contactA.id, status: 'AI_HANDLING' } });
  convB = await prisma.conversation.create({ data: { tenantId: tenantB.id, leadId: leadB.id, contactId: contactB.id, status: 'AI_HANDLING' } });

  await prisma.message.create({ data: { tenantId: tenantB.id, conversationId: convB.id, direction: 'INBOUND', sender: 'CONTACT', type: 'TEXT', content: 'B SECRET MESSAGE — should never reach tenant A', status: 'PENDING' } });
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
  // Loading conversations.routes.js transitively requires message.queue.js,
  // which auto-connects to Redis (config/redis.js sets
  // maxRetriesPerRequest: null for BullMQ, so a connection with nothing to
  // talk to retries forever rather than giving up). That keeps the event
  // loop alive and node --test never exits on its own. Force it once
  // node:test has recorded pass/fail, rather than hunting down every
  // keep-alive handle the app itself owns.
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

test('A cannot read B\'s lead by direct ID', async () => {
  const res = await request('GET', `/leads/${leadB.id}`, authHeader(userA));
  assert.equal(res.status, 404, `expected 404, got ${res.status}: ${res.raw}`);
});

test('A\'s lead list never contains B\'s leads', async () => {
  const res = await request('GET', '/leads', authHeader(userA));
  assert.equal(res.status, 200);
  const ids = (res.body?.data?.leads || []).map((l) => l.id);
  assert.ok(!ids.includes(leadB.id), 'tenant B lead id leaked into tenant A list response');
});

test('A cannot change B\'s lead stage', async () => {
  const res = await request('PATCH', `/leads/${leadB.id}/stage`, authHeader(userA), { stage: 'CLOSED_WON' });
  assert.equal(res.status, 404, `expected 404, got ${res.status}: ${res.raw}`);
  const still = await prisma.lead.findUnique({ where: { id: leadB.id } });
  assert.equal(still.stage, 'NEW', 'tenant A mutated tenant B lead stage');
});

test('A cannot delete B\'s lead', async () => {
  const res = await request('DELETE', `/leads/${leadB.id}`, authHeader(userA));
  assert.equal(res.status, 404, `expected 404, got ${res.status}: ${res.raw}`);
  const still = await prisma.lead.findUnique({ where: { id: leadB.id } });
  assert.ok(still, 'tenant A deleted tenant B lead');
});

test('A cannot read B\'s conversation, or its message content', async () => {
  const res = await request('GET', `/conversations/${convB.id}`, authHeader(userA));
  assert.equal(res.status, 404, `expected 404, got ${res.status}: ${res.raw}`);
  assert.ok(!res.raw.includes('SECRET MESSAGE'), 'tenant B message content leaked into tenant A response body');
});

test('A\'s conversation list never contains B\'s conversations', async () => {
  const res = await request('GET', '/conversations', authHeader(userA));
  assert.equal(res.status, 200);
  const ids = (res.body?.data?.conversations || []).map((c) => c.id);
  assert.ok(!ids.includes(convB.id), 'tenant B conversation id leaked into tenant A list response');
});

test('A cannot clear or delete B\'s conversation', async () => {
  const clear = await request('DELETE', `/conversations/${convB.id}/messages`, authHeader(userA));
  assert.equal(clear.status, 404, `expected 404 on clear, got ${clear.status}`);
  const del = await request('DELETE', `/conversations/${convB.id}`, authHeader(userA));
  assert.equal(del.status, 404, `expected 404 on delete, got ${del.status}`);
  const stillThere = await prisma.conversation.findUnique({ where: { id: convB.id } });
  assert.ok(stillThere, 'tenant A deleted tenant B conversation');
});

test('B\'s JWT genuinely reaches B\'s own data (sanity check the harness itself)', async () => {
  const res = await request('GET', `/leads/${leadB.id}`, authHeader(userB));
  assert.equal(res.status, 200, 'tenant B could not read its own lead — the test harness or auth is broken, not proof of isolation');
});

test('an unauthenticated request is rejected outright', async () => {
  const res = await request('GET', `/leads/${leadA.id}`, null);
  assert.equal(res.status, 401);
});
