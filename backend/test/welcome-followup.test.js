const test = require('node:test');
const assert = require('node:assert');
const { welcomeFollowupText, sendWelcomeFollowup, sendCatchUpWelcome } = require('../src/services/welcomeFollowup.service');

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

const mk = (found) => {
  const rows = [];
  return { rows, prisma: { message: { findFirst: async () => (found ? { id: 'm' } : null), create: async ({ data }) => { rows.push(data); return data; } } } };
};
const T = { id: 't', settings: { welcomeFollowupText: 'Watch https://x.y' }, aiConfig: { welcomeVoiceEnabled: true, welcomeVoiceMediaId: 'media' } };
const deps = (p) => ({ tenant: T, phone: '1', conversationId: 'c', prisma: p.prisma, whatsappService: { sendText: async () => 'wamid.t' }, welcomeVoiceService: { sendWelcomeVoice: async () => 'wamid.v' }, logger, delayMs: 0 });

test('catch-up: old lead without the link gets voice + link once', async () => {
  const p = mk(false);
  const ok = await sendCatchUpWelcome({ ...deps(p), contact: { id: 'k', sentWelcomeVoice: true }, lead: { stage: 'QUALIFYING' } });
  assert.equal(ok, true);
  assert.deepEqual(p.rows.map((r) => r.type), ['AUDIO', 'TEXT']);
});
test('catch-up: skipped when the link was already sent, for paid students, and for brand-new contacts', async () => {
  assert.equal(await sendCatchUpWelcome({ ...deps(mk(true)), contact: { id: 'k', sentWelcomeVoice: true }, lead: { stage: 'QUALIFYING' } }), false);
  assert.equal(await sendCatchUpWelcome({ ...deps(mk(false)), contact: { id: 'k', sentWelcomeVoice: true }, lead: { stage: 'CLOSED_WON' } }), false);
  assert.equal(await sendCatchUpWelcome({ ...deps(mk(false)), contact: { id: 'k', sentWelcomeVoice: true }, lead: { stage: 'NEW', alreadyEnrolledAt: new Date() } }), false);
  assert.equal(await sendCatchUpWelcome({ ...deps(mk(false)), contact: { id: 'k', sentWelcomeVoice: false }, lead: { stage: 'NEW' } }), false);
});
