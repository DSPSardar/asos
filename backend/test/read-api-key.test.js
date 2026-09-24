// test/read-api-key.test.js
//
// Read-only API-key path (src/middleware/readApiKey.js) over real HTTP
// against the real Express app. No Postgres: the in-memory Prisma stand-in
// covers the auth/RLS plumbing, and the three services behind the
// allow-listed routes are stubbed so the assertions are about the guard —
// who gets in, on which routes, and what leaves the response — not about
// the aggregation queries (getPipeline uses groupBy, which the stand-in
// does not model).
//
// Run: node --test test/read-api-key.test.js
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const GOOD_KEY = 'test-read-only-key-value-for-this-file-only';
const TENANT_ID = '87bfa1b0-1774-4278-b630-d30836cf4183';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://unused:unused@127.0.0.1:5432/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-at-least-32-chars';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'z'.repeat(64);
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.ASOS_READ_API_KEY = GOOD_KEY;
process.env.ASOS_READ_API_TENANT_ID = TENANT_ID;
process.env.PORT = '0';

const { installFakePrisma } = require('./_fakePrisma');
installFakePrisma();

// BullMQ does not treat the fake redis as an ioredis instance and would open
// its own connection to localhost:6379 at import, retrying forever and
// keeping the test process alive. None of the routes under test enqueue.
{
  const p = path.resolve(__dirname, '../src/queues/message.queue.js');
  const noop = async () => null;
  const exports = new Proxy({ QUEUE_NAMES: { MESSAGE_QUEUE: 'asos-messages', META_EVENTS_QUEUE: 'asos-meta-events', SCHEDULER_QUEUE: 'asos-scheduler' } }, {
    get: (t, k) => (k in t ? t[k] : noop),
  });
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// Stub the services behind the allow-listed routes with data that carries
// exactly the fields the middleware must strip, plus the ones it must keep.
// Each stub also records the tenantId it was called with, so the test can
// prove the key never reads anything but the configured tenant.
const calls = [];
const stub = (rel, exports) => {
  const p = path.resolve(__dirname, '../src/modules', rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

const contact = { id: 'c1', name: 'Ayesha', phone: '+923001234567', email: 'ayesha@example.com', customFields: { source: 'DSP_CRM', altPhone: '+92300000000' } };
const lead = { id: 'l1', stage: 'QUALIFYING', aiScore: 8, dealValue: '25000', enrollmentFee: null, contact, agent: { fullName: 'Agent One' } };

stub('leads/leads.service.js', {
  getPipeline: async (tenantId) => { calls.push(['pipeline', tenantId]); return { pipeline: { QUALIFYING: [lead] }, stats: [{ stage: 'QUALIFYING', count: 1, value: 25000 }], enrolled: 3 }; },
  getHotLeads: async (tenantId) => { calls.push(['hot', tenantId]); return [{ ...lead, conversations: [{ id: 'cv1', paymentProofDetected: false, messages: [{ content: 'ready to pay' }] }] }]; },
  getLeads: async (tenantId) => { calls.push(['list', tenantId]); return { leads: [lead], total: 1 }; },
});
stub('insights/insights.service.js', {
  getSentimentTrend: async (tenantId) => { calls.push(['sentiment', tenantId]); return [{ day: '2026-09-20', positive: 4, negative: 1 }]; },
  getSignals: async (tenantId) => { calls.push(['signals', tenantId]); return [{ name: 'Ayesha', phone: '+923001234567', signalType: 'BUYING', content: 'kab start hoga?' }]; },
  getDigest: async (tenantId) => { calls.push(['digest', tenantId]); return { hotLeads: 2, wonThisWeek: 1, revenue: 50000 }; },
});
stub('analytics/analytics.service.js', {
  getOverview: async (tenantId) => { calls.push(['overview', tenantId]); return { leads: { total: 10, hot: 2, enrolled: 3 }, revenue: { total: 75000, currency: 'PKR' }, messages: { total: 40, aiHandled: 30, aiHandlingRate: '75.0%' } }; },
});

let server, port;

const request = (method, urlPath, headers = {}) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(raw); } catch { /* non-JSON */ }
      resolve({ status: res.statusCode, body: json, raw, headers: res.headers });
    });
  });
  req.on('error', (e) => resolve({ status: 0, body: null, raw: e.message }));
  req.end();
});

const withKey = (method, urlPath, key = GOOD_KEY) => request(method, urlPath, { 'X-API-Key': key });

// Every key name in the body, at any depth.
const keysDeep = (v, acc = []) => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.push(k); keysDeep(x, acc); }
  return acc;
};
const SENSITIVE = /phone|e-?mail|bank|payment|iban/i;

before(async () => {
  const createApp = require('../src/app');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test('good key GET on an allow-listed route → 200, standard envelope, configured tenant', async () => {
  const res = await withKey('GET', '/api/v1/leads/pipeline');
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.pipeline.QUALIFYING[0].contact.name, 'Ayesha');
  assert.equal(res.body.data.enrolled, 3);
  assert.deepEqual(calls.at(-1), ['pipeline', TENANT_ID]);
});

test('good key works on every allow-listed route', async () => {
  for (const p of ['/api/v1/leads/hot', '/api/v1/insights/sentiment', '/api/v1/insights/signals', '/api/v1/insights/digest', '/api/v1/analytics/overview']) {
    const res = await withKey('GET', p);
    assert.equal(res.status, 200, `${p}: ${res.raw}`);
    assert.equal(res.body.success, true, p);
    assert.equal(calls.at(-1)[1], TENANT_ID, p);
  }
});

test('bad key → 401 invalid_api_key, never falls through to JWT', async () => {
  const before = calls.length;
  const res = await withKey('GET', '/api/v1/leads/pipeline', 'wrong-key');
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: 'invalid_api_key' });
  assert.equal(calls.length, before, 'no service call on a rejected key');

  // Empty header value is also a bad key, not "no key".
  const empty = await withKey('GET', '/api/v1/leads/pipeline', '');
  assert.equal(empty.status, 401);
  assert.deepEqual(empty.body, { error: 'invalid_api_key' });
});

test('good key with POST → 401 invalid_api_key (GET only)', async () => {
  const before = calls.length;
  const res = await withKey('POST', '/api/v1/leads');
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: 'invalid_api_key' });
  assert.equal(calls.length, before, 'no service call on a rejected method');

  const patch = await withKey('PATCH', '/api/v1/leads/l1/stage');
  assert.equal(patch.status, 401);
});

test('good key on GET /leads (list) → 403, nothing read', async () => {
  const before = calls.length;
  const res = await withKey('GET', '/api/v1/leads');
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'forbidden' });
  assert.equal(calls.length, before);

  // Near-misses of an allow-listed path are not matches either.
  for (const p of ['/api/v1/leads/pipeline/', '/api/v1/leads/hot/x', '/api/v1/leads/handoff', '/api/v1/analytics/funnel']) {
    const r = await withKey('GET', p);
    assert.equal(r.status, 403, p);
  }
});

test('READ_ONLY responses contain no phone / email / payment fields', async () => {
  for (const p of ['/api/v1/leads/pipeline', '/api/v1/leads/hot', '/api/v1/insights/signals']) {
    const res = await withKey('GET', p);
    assert.equal(res.status, 200, p);
    const leaked = keysDeep(res.body).filter((k) => SENSITIVE.test(k));
    assert.deepEqual(leaked, [], `${p} leaked ${leaked.join(', ')}`);
    assert.ok(!res.raw.includes('+923001234567'), `${p} leaked the phone value`);
    assert.ok(!res.raw.includes('ayesha@example.com'), `${p} leaked the email value`);
  }
  // Names, counts and amounts are kept.
  const hot = await withKey('GET', '/api/v1/leads/hot');
  assert.equal(hot.body.data[0].contact.name, 'Ayesha');
  assert.equal(hot.body.data[0].dealValue, '25000');
  assert.equal(hot.body.data[0].contact.customFields.source, 'DSP_CRM');
});

test('no X-API-Key header → untouched JWT path (401 from the bearer guard)', async () => {
  const res = await request('GET', '/api/v1/leads/pipeline');
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Authorization header/);
});

test('per-key limiter advertises 60/min', async () => {
  const res = await withKey('GET', '/api/v1/analytics/overview');
  assert.equal(res.status, 200);
  assert.equal(res.headers['ratelimit-limit'], '60');
});
