const test = require('node:test');
const assert = require('node:assert');
const { welcomeFollowupText, sendWelcomeFollowup } = require('../src/services/welcomeFollowup.service');

const logger = { error() {}, info() {} };

test('no setting means nothing is sent', async () => {
  let sent = 0;
  const id = await sendWelcomeFollowup({ tenant: { id: 't', settings: {} }, phone: '1', conversationId: 'c', prisma: { message: { create: async () => {} } }, whatsappService: { sendText: async () => { sent++; return 'x'; } }, logger, delayMs: 0 });
  assert.equal(id, null); assert.equal(sent, 0);
  assert.equal(welcomeFollowupText({ settings: { welcomeFollowupText: '   ' } }), null);
});

test('sends the text with link preview on and records it', async () => {
  const calls = []; const rows = [];
  const tenant = { id: 't1', settings: { welcomeFollowupText: '*Watch*\nhttps://example.com/x' } };
  const id = await sendWelcomeFollowup({ tenant, phone: '923001112222', conversationId: 'c1', prisma: { message: { create: async ({ data }) => rows.push(data) } }, whatsappService: { sendText: async (...a) => { calls.push(a); return 'wamid.1'; } }, logger, delayMs: 0 });
  assert.equal(id, 'wamid.1');
  assert.deepEqual(calls[0][3], { previewUrl: true });
  assert.equal(rows[0].type, 'TEXT'); assert.equal(rows[0].status, 'SENT'); assert.equal(rows[0].conversationId, 'c1');
});

test('a failed send is recorded as FAILED and never throws', async () => {
  const rows = [];
  const id = await sendWelcomeFollowup({ tenant: { id: 't', settings: { welcomeFollowupText: 'hi' } }, phone: '1', conversationId: 'c', prisma: { message: { create: async ({ data }) => rows.push(data) } }, whatsappService: { sendText: async () => { throw new Error('meta down'); } }, logger, delayMs: 0 });
  assert.equal(id, null); assert.equal(rows[0].status, 'FAILED');
});
