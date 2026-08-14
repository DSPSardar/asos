// test/inbound-media-persistence.test.js
//
// Regression guard for the "[Image]" placeholder bug, updated for the fix's
// second iteration. The first version of this fix wrote inbound media to
// local disk — which turned out to be broken in production: Railway's
// `asos` (serves media) and `asos-worker` (downloads it) are separate
// containers with separate, non-persistent filesystems, so a file the
// worker wrote was invisible to the service actually serving it, and
// wouldn't have survived a redeploy either way. This version stores the
// bytes in Postgres (InboundMedia) instead, which any service instance can
// read and which persists across deploys like every other table.
//
// This exercises the real saveInboundMedia() (not a reimplementation)
// against a stubbed 'axios' (Meta's media API) and a stubbed '@prisma/client'
// so nothing leaves this machine, then checks it round-trips through a
// fetch-by-id the way GET /media/:id in app.js actually does it.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/db';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);
process.env.OPENAI_API_KEY ||= 'sk-test';

const FAKE_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const fakeTenant = { id: 'test-tenant-id', waPhoneId: '123', waAccessToken: 'plain-test-token' };

// In-memory stand-in for the inbound_media table, shared by the stubbed
// prisma client's create/findUnique so the test can prove a real round trip
// (write via saveInboundMedia, read via the same shape app.js's route uses)
// rather than just asserting on the write in isolation.
function makeFakeDatabaseModule() {
  const rows = new Map();
  const fakePrisma = {
    inboundMedia: {
      create: async ({ data }) => {
        const id = `fake-media-id-${rows.size + 1}`;
        rows.set(id, { id, ...data });
        return { id };
      },
      findUnique: async ({ where: { id }, select }) => {
        const row = rows.get(id);
        if (!row) return null;
        if (!select) return row;
        const out = {};
        for (const key of Object.keys(select)) if (select[key]) out[key] = row[key];
        return out;
      },
    },
  };
  return { fakePrisma, __rows: rows };
}

test('downloads inbound media and persists it to Postgres, returning a usable /media/<id> url', async (t) => {
  const originalLoad = Module._load;
  const { fakePrisma, __rows } = makeFakeDatabaseModule();

  Module._load = function (request, parent, isMain) {
    if (request === '../config/database') return fakePrisma;
    if (request === 'axios') {
      return {
        get: async (url) => {
          if (url === 'https://graph.facebook.com/v20.0/test-media-id') {
            return { data: { url: 'https://fake-media-cdn.example/blob-abc123' } };
          }
          if (url === 'https://fake-media-cdn.example/blob-abc123') {
            return { data: FAKE_JPEG_BYTES, headers: { 'content-type': 'image/jpeg' } };
          }
          throw new Error(`Unexpected axios.get in test: ${url}`);
        },
        create: () => ({ post: async () => ({ data: {} }) }),
      };
    }
    return originalLoad.apply(this, arguments);
  };

  t.after(() => {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../src/services/whatsapp.service')];
    delete require.cache[require.resolve('../src/config/database')];
  });

  delete require.cache[require.resolve('../src/services/whatsapp.service')];
  delete require.cache[require.resolve('../src/config/database')];
  const whatsappService = require('../src/services/whatsapp.service');

  const result = await whatsappService.saveInboundMedia(fakeTenant, 'test-media-id');

  assert.ok(result, 'saveInboundMedia should not return null on a successful download');
  assert.match(result.url, /^\/media\/fake-media-id-\d+$/, "mediaUrl should be the /media/<id> shape app.js's route serves");
  assert.equal(result.mimeType, 'image/jpeg');
  assert.ok(result.buffer.equals(FAKE_JPEG_BYTES), 'returned buffer should be the exact downloaded bytes');

  // The point of this fix: prove the write is readable back by id — the
  // same lookup GET /media/:id performs — not just that .create() was
  // called with the right shape.
  const rowId = result.url.replace('/media/', '');
  const stored = __rows.get(rowId);
  assert.ok(stored, 'a row should exist in the (fake) inbound_media table for this id');
  assert.equal(stored.tenantId, 'test-tenant-id');
  assert.equal(stored.mimeType, 'image/jpeg');
  assert.ok(Buffer.isBuffer(stored.data) ? stored.data.equals(FAKE_JPEG_BYTES) : stored.data === FAKE_JPEG_BYTES,
    'the bytes stored under this id should match what was downloaded');
});

test('returns null (not a throw) when the Meta media lookup fails, so the caller can fall back to text-only', async (t) => {
  const originalLoad = Module._load;
  const { fakePrisma, __rows } = makeFakeDatabaseModule();

  Module._load = function (request, parent, isMain) {
    if (request === '../config/database') return fakePrisma;
    if (request === 'axios') {
      return {
        get: async () => { throw new Error('simulated Meta API failure'); },
        create: () => ({ post: async () => ({ data: {} }) }),
      };
    }
    return originalLoad.apply(this, arguments);
  };

  t.after(() => {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../src/services/whatsapp.service')];
    delete require.cache[require.resolve('../src/config/database')];
  });

  delete require.cache[require.resolve('../src/services/whatsapp.service')];
  delete require.cache[require.resolve('../src/config/database')];
  const whatsappService = require('../src/services/whatsapp.service');

  const result = await whatsappService.saveInboundMedia(fakeTenant, 'bad-media-id');
  assert.equal(result, null);
  assert.equal(__rows.size, 0, 'no row should be created when the download itself failed');
});
