// test/inbound-media-persistence.test.js
//
// Regression guard for the other half of the reported bug: the Conversations
// dashboard showed the literal text "[Image]" instead of the photo a student
// sent, because no code path ever downloaded the media or stored a URL for
// it. saveInboundMedia() is the fix — this exercises the real function
// (not a reimplementation) against a stubbed 'axios' so it never leaves
// this machine, and then checks the actual file it wrote on disk.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/db';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);
process.env.OPENAI_API_KEY ||= 'sk-test';

const FAKE_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const fakeTenant = { id: 'test-tenant-id', waPhoneId: '123', waAccessToken: 'plain-test-token' };

test('downloads and persists an inbound image, returning a usable mediaUrl', async (t) => {
  // Run inside a scratch cwd so the function's process.cwd()-relative
  // 'uploads/' write lands somewhere disposable, not in the repo checkout.
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asos-media-test-'));
  const originalCwd = process.cwd();
  process.chdir(scratchDir);

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'axios') {
      return {
        get: async (url, config) => {
          // Two distinct axios.get calls happen in sequence inside the real
          // downloadMedia(): first the Graph API media-lookup (by mediaId),
          // then a fetch of the temporary signed URL it returns. Match each
          // by exact URL so a suffix collision can't route the wrong
          // response to the wrong call (the earlier version of this test
          // had exactly that bug).
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
    process.chdir(originalCwd);
    fs.rmSync(scratchDir, { recursive: true, force: true });
    delete require.cache[require.resolve('../src/services/whatsapp.service')];
  });

  delete require.cache[require.resolve('../src/services/whatsapp.service')];
  const whatsappService = require('../src/services/whatsapp.service');

  const result = await whatsappService.saveInboundMedia(fakeTenant, 'test-media-id', { messageType: 'image' });

  assert.ok(result, 'saveInboundMedia should not return null on a successful download');
  assert.match(result.url, /^\/uploads\/inbound-media\/test-tenant-id\/[0-9a-f-]+\.jpg$/,
    'mediaUrl should follow the documented /uploads/inbound-media/<tenantId>/<uuid>.<ext> shape');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.ok(result.buffer.equals(FAKE_JPEG_BYTES), 'returned buffer should be the exact downloaded bytes');

  // The actual point of this fix: the file must really be on disk at the
  // path the frontend's resolveUploadUrl()/express.static('/uploads') will
  // be asked to serve — not just an in-memory object.
  const diskPath = path.join(scratchDir, result.url);
  assert.ok(fs.existsSync(diskPath), `file should exist on disk at ${diskPath}`);
  assert.ok(fs.readFileSync(diskPath).equals(FAKE_JPEG_BYTES), 'file on disk should match the downloaded bytes exactly');
});

test('returns null (not a throw) when the Meta media lookup fails, so the caller can fall back to text-only', async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asos-media-test-'));
  const originalCwd = process.cwd();
  process.chdir(scratchDir);

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
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
    process.chdir(originalCwd);
    fs.rmSync(scratchDir, { recursive: true, force: true });
    delete require.cache[require.resolve('../src/services/whatsapp.service')];
  });

  delete require.cache[require.resolve('../src/services/whatsapp.service')];
  const whatsappService = require('../src/services/whatsapp.service');

  const result = await whatsappService.saveInboundMedia(fakeTenant, 'bad-media-id', { messageType: 'image' });
  assert.equal(result, null);
});
