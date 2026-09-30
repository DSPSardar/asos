// test/mcp-connector.test.js
//
// The AI Assistant connector (src/modules/mcp/) over real HTTP against the
// real Express app and the real MCP SDK transport. No Postgres: the
// in-memory Prisma stand-in holds two tenants, so the tests can prove a key
// only ever sees its own tenant, that personal data is masked, and that
// bad / revoked / suspended keys get nothing.
//
// Run: node --test test/mcp-connector.test.js
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://unused:unused@127.0.0.1:5432/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-at-least-32-chars';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'z'.repeat(64);
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.PORT = '0';

const { installFakePrisma } = require('./_fakePrisma');
const db = installFakePrisma();

// Same BullMQ guard as read-api-key.test.js — nothing here enqueues.
{
  const p = path.resolve(__dirname, '../src/queues/message.queue.js');
  const noop = async () => null;
  const exports = new Proxy({ QUEUE_NAMES: { MESSAGE_QUEUE: 'asos-messages', META_EVENTS_QUEUE: 'asos-meta-events', SCHEDULER_QUEUE: 'asos-scheduler' } }, {
    get: (t, k) => (k in t ? t[k] : noop),
  });
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// The Today queue has its own tests (needs-you-queue.test.js); here we only
// need to prove needs_me asks for the right tenant and masks what it returns.
const queueCalls = [];
const queueContexts = [];
{
  const p = path.resolve(__dirname, '../src/services/needsYou.service.js');
  const exports = {
    collectQueue: async (tenantId) => {
      const { getRequestContext } = require('../src/middleware/requestContext.middleware');
      queueCalls.push(tenantId);
      queueContexts.push({ ...getRequestContext() });
      return {
        rows: [{ group: 'needs_me', reason: 'payment_proof', conversationId: 'cv-a', leadId: 'l-a', name: 'Ayesha', phone: '923001234567', stage: 'PROPOSED', scoreLabel: 'HOT', aiScore: 90, hoursWaiting: 5, summary: 'paid, account 1234567890123', insideWindow: true }],
        totals: { needs_me: 1, unanswered: 0, quiet: 0, stalled: 0 },
        context: { handledByAi: 7 },
      };
    },
  };
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CONV_A = '33333333-3333-4333-8333-333333333333';
const CONV_B = '44444444-4444-4444-8444-444444444444';

let server, port, keyA, keyB, keySuspended;

const post = (urlPath, body, headers = {}) => new Promise((resolve) => {
  const payload = JSON.stringify(body);
  const req = http.request({
    host: '127.0.0.1', port, method: 'POST', path: urlPath,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(payload), ...headers },
  }, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* */ } resolve({ status: res.statusCode, body: json, raw }); });
  });
  req.on('error', (e) => resolve({ status: 0, body: null, raw: e.message }));
  req.end(payload);
});

const get = (urlPath) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
});

const rpc = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const INIT = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
const bearer = (k) => ({ Authorization: `Bearer ${k}` });
const callTool = (key, name, args = {}) => post('/mcp', rpc('tools/call', { name, arguments: args }, 7), bearer(key));
const toolJson = (res) => JSON.parse(res.body.result.content[0].text);

before(async () => {
  const now = new Date();
  const T = db._tables;
  T.tenant.push({ id: TENANT_A, slug: 'a', name: 'A', status: 'ACTIVE', settings: {} });
  T.tenant.push({ id: TENANT_B, slug: 'b', name: 'B', status: 'ACTIVE', settings: {} });
  T.tenant.push({ id: 'tenant-s', slug: 's', name: 'S', status: 'SUSPENDED', settings: {} });

  T.contact.push({ id: 'c-a', tenantId: TENANT_A, name: 'Ayesha Khan', phone: '923001234567', email: 'ayesha@example.com' });
  T.contact.push({ id: 'c-b', tenantId: TENANT_B, name: 'Ayesha Other', phone: '923009999888', email: 'other@example.com' });
  T.lead.push({ id: 'l-a', tenantId: TENANT_A, contactId: 'c-a', stage: 'CLOSED_WON', scoreLabel: 'HOT', aiScore: 95, enrollmentFee: '28000', dealValue: null, currency: 'PKR', closedAt: now, product: 'MASTERY', problemSummary: 'Wants Mastery; email ayesha@example.com', updatedAt: now });
  T.lead.push({ id: 'l-b', tenantId: TENANT_B, contactId: 'c-b', stage: 'NEW', scoreLabel: 'COLD', aiScore: 5, updatedAt: now });
  T.conversation.push({ id: CONV_A, tenantId: TENANT_A, leadId: 'l-a', contactId: 'c-a', status: 'PENDING_VERIFICATION', aiEnabled: true, lastMessageAt: now, paymentProofAt: new Date(now - 3 * 3600e3) });
  T.conversation.push({ id: CONV_B, tenantId: TENANT_B, leadId: 'l-b', contactId: 'c-b', status: 'ACTIVE', aiEnabled: true, lastMessageAt: now });
  T.message.push({ id: 'm1', tenantId: TENANT_A, conversationId: CONV_A, direction: 'INBOUND', sender: 'CONTACT', type: 'TEXT', content: 'Sent 28000 from 0300-1234567, IBAN PK36SCBL0000001123456702', sentAt: new Date(now - 60e3) });
  T.message.push({ id: 'm2', tenantId: TENANT_A, conversationId: CONV_A, direction: 'OUTBOUND', sender: 'AI', type: 'TEXT', content: 'Shukriya! We will verify shortly.', sentAt: now });
  T.message.push({ id: 'm3', tenantId: TENANT_B, conversationId: CONV_B, direction: 'INBOUND', sender: 'CONTACT', type: 'TEXT', content: 'tenant B secret', sentAt: now });

  const svc = require('../src/modules/mcp/apiKeys.service');
  keyA = (await svc.createKey(TENANT_A, { name: 'ChatGPT' })).key;
  keyB = (await svc.createKey(TENANT_B, { name: 'Claude' })).key;
  keySuspended = (await svc.createKey('tenant-s', { name: 'x' })).key;

  const createApp = require('../src/app');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
});

after(async () => { await new Promise((r) => server.close(r)); });

test('keys are stored hashed, shown once, prefixed asos_', () => {
  assert.match(keyA, /^asos_[A-Za-z0-9_-]{30,}$/);
  const row = db._tables.apiKey.find((k) => k.tenantId === TENANT_A);
  assert.notEqual(row.keyHash, keyA);
  assert.equal(row.keyHash.length, 64);
  assert.ok(!JSON.stringify(db._tables.apiKey).includes(keyA), 'raw key never stored');
});

test('initialize + tools/list with a good key → 9 read-only tools', async () => {
  const init = await post('/mcp', INIT, bearer(keyA));
  assert.equal(init.status, 200, init.raw);
  assert.equal(init.body.result.serverInfo.name, 'asos');
  assert.match(init.body.result.instructions, /READ-ONLY/);

  const list = await post('/mcp', rpc('tools/list', {}, 2), bearer(keyA));
  assert.equal(list.status, 200, list.raw);
  const names = list.body.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['conversation', 'find_lead', 'hot_leads', 'needs_me', 'pending_payments', 'performance', 'pipeline', 'revenue', 'today_summary']);
  for (const t of list.body.result.tools) assert.equal(t.annotations.readOnlyHint, true, t.name);
});

test('no key, wrong key, revoked key, suspended tenant → 401 and no tool runs', async () => {
  const before = db._tables.mcpCallLog.length;
  assert.equal((await post('/mcp', INIT)).status, 401);
  assert.equal((await post('/mcp', INIT, bearer('asos_wrongwrongwrongwrongwrongwrong'))).status, 401);
  assert.equal((await post('/mcp', INIT, bearer(keySuspended))).status, 401);

  const svc = require('../src/modules/mcp/apiKeys.service');
  const { key: temp, apiKey } = await svc.createKey(TENANT_A, { name: 'temp' });
  assert.equal((await post('/mcp', INIT, bearer(temp))).status, 200);
  await svc.revokeKey(TENANT_A, apiKey.id);
  assert.equal((await post('/mcp', INIT, bearer(temp))).status, 401);
  assert.equal(db._tables.mcpCallLog.length, before);
});

test('key in the URL and X-API-Key header both work; GET is 405 (stateless)', async () => {
  assert.equal((await post(`/mcp/k/${keyA}`, INIT)).status, 200);
  assert.equal((await post('/mcp', INIT, { 'X-API-Key': keyA })).status, 200);
  assert.equal((await get('/mcp')).status, 405);
});

test('find_lead: own tenant only, phone masked, email and fee rules applied', async () => {
  const res = await callTool(keyA, 'find_lead', { query: 'ayesha' });
  assert.equal(res.status, 200, res.raw);
  const out = toolJson(res);
  assert.equal(out.showing, 1, 'tenant B has an "Ayesha" too — must not appear');
  const item = out.items[0];
  assert.equal(item.name, 'Ayesha Khan');
  assert.equal(item.phone, '•••567');
  assert.deepEqual({ amount: item.paid.amount, currency: item.paid.currency }, { amount: 28000, currency: 'PKR' });
  assert.equal(item.what_they_want, 'Wants Mastery; email [email]');
  assert.ok(!res.raw.includes('923001234567') && !res.raw.includes('ayesha@example.com'));

  const byDigits = toolJson(await callTool(keyA, 'find_lead', { query: '567' }));
  assert.equal(byDigits.showing, 1);
  const other = toolJson(await callTool(keyB, 'find_lead', { query: '567' }));
  assert.equal(other.showing, 0);
});

test('conversation: redacts numbers/IBAN in messages; another tenant\'s id is not found', async () => {
  const res = await callTool(keyA, 'conversation', { conversation_id: CONV_A });
  const out = toolJson(res);
  assert.equal(out.messages.length, 2);
  assert.equal(out.messages[0].from, 'customer');
  assert.ok(!res.raw.includes('0300-1234567') && !res.raw.includes('PK36SCBL'), res.raw);
  assert.match(out.messages[0].text, /\[number\]/);

  const cross = await callTool(keyA, 'conversation', { conversation_id: CONV_B });
  assert.equal(cross.body.result.isError, true);
  assert.ok(!cross.raw.includes('tenant B secret'));
});

test('pending_payments and needs_me: own tenant, masked, audit rows written', async () => {
  const before = db._tables.mcpCallLog.length;
  const pp = toolJson(await callTool(keyA, 'pending_payments'));
  assert.equal(pp.showing, 0, 'the only pending conversation belongs to a lead already CLOSED_WON');

  const nm = toolJson(await callTool(keyA, 'needs_me', { group: 'needs_me' }));
  assert.equal(queueCalls.at(-1), TENANT_A);
  // RLS context inside a tool: the key's tenant, and never the system scope
  // the key lookup itself used.
  assert.equal(queueContexts.at(-1).tenantId, TENANT_A);
  assert.equal(queueContexts.at(-1).rlsScope, '');
  assert.equal(nm.items[0].phone, '•••567');
  assert.equal(nm.items[0].their_last_words, 'paid, account [number]');
  assert.match(nm.items[0].why, /payment proof/);

  const logs = db._tables.mcpCallLog.slice(before);
  assert.equal(logs.length, 2);
  assert.ok(logs.every((l) => l.tenantId === TENANT_A && l.ok === true && Number.isInteger(l.durationMs)));
});

test('scrub / maskPhone units', () => {
  const { scrub, maskPhone } = require('../src/modules/mcp/mcp.tools');
  assert.equal(maskPhone('+92 300 123 4567'), '•••567');
  assert.equal(maskPhone(null), null);
  assert.equal(scrub('call +92 345 1234567 or mail x.y@z.pk'), 'call [number] or mail [email]');
  assert.equal(scrub('fee 28000 hai'), 'fee 28000 hai', 'short amounts are kept');
  // WhatsApp profile names are sometimes an email or a number (seen in live data).
  const { cleanName } = require('../src/modules/mcp/mcp.tools');
  assert.equal(cleanName('msana.bce@gmail.com'), '[email]');
  assert.equal(cleanName('+92 300 1234567'), '[number]');
  assert.equal(cleanName('  '), 'Unknown');
  assert.equal(cleanName('Ayesha Khan'), 'Ayesha Khan');
});

// Real Prisma queries are lazy: they execute when awaited, not when called.
// The fake is eager, which once hid a bug where the key lookup ran outside
// its RLS context in production. Make the fake's findUnique lazy and record
// the context it actually executes in.
test('key lookup executes inside its system RLS scope even with a lazy Prisma', async () => {
  const { getRequestContext } = require('../src/middleware/requestContext.middleware');
  const svc = require('../src/modules/mcp/apiKeys.service');
  const eager = db.apiKey.findUnique;
  const seen = [];
  db.apiKey.findUnique = (args) => ({
    then: (ok, fail) => { seen.push(getRequestContext().rlsScope); return eager(args).then(ok, fail); },
  });
  try {
    const found = await svc.resolveKey(keyA);
    assert.ok(found, 'valid key resolves');
    assert.deepEqual(seen, ['system'], 'query executed inside the system scope');
  } finally {
    db.apiKey.findUnique = eager;
  }
});
