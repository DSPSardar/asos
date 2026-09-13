// test/mastery-welcome-chain.test.js
//
// Item 7 — end to end, without Postgres: approving an enrolment in the
// Mastery admin POSTs `enrolled` to /webhooks/mastery → the WhatsApp lead
// becomes CLOSED_WON, the payment thread is closed out, a SYSTEM activity
// with masteryEvent=enrolled is written, and the "Mastery: Welcome to the
// dashboard" automation (trigger mastery_event) sends the welcome WhatsApp
// with the group invite on the next tick.
//
// The bug this pins: the webhook only wrote a STAGE_CHANGE activity, and the
// automation engine matches SYSTEM activities — so the rule showed
// "Nothing sent yet" forever.
'use strict';

const DSP = '87bfa1b0-1774-4278-b630-d30836cf4183';
Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/test',
  JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(32),
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'y'.repeat(32),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'sk-test',
  MASTERY_TENANT_ID: DSP,
  MASTERY_EVENTS_SECRET: 'events-secret',
  WHATSAPP_MOCK: 'true',
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { installFakePrisma } = require('./_fakePrisma');

const db = installFakePrisma();
const masteryWebhook = require('../src/webhooks/mastery.webhook');
const automationService = require('../src/services/automation.service');

const app = express();
app.use('/webhooks/mastery', express.raw({ type: '*/*' }), masteryWebhook);

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000);
const GROUP_LINK = 'https://chat.whatsapp.com/DSPMasteryGroup';

const seed = async () => {
  await db.tenant.create({ data: { id: DSP, name: 'DSP', status: 'ACTIVE', settings: {}, waPhoneId: null, waAccessToken: null } });
  const contact = await db.contact.create({ data: { tenantId: DSP, phone: '923001234567', name: 'Ali Raza', email: null } });
  const lead = await db.lead.create({ data: { tenantId: DSP, contactId: contact.id, stage: 'PROPOSED', product: 'MASTERY', scoreLabel: 'HOT', aiScore: 90 } });
  const conv = await db.conversation.create({ data: { tenantId: DSP, leadId: lead.id, contactId: contact.id, status: 'PENDING_VERIFICATION', aiEnabled: false,
    paymentDetailsSentAt: hoursAgo(3), paymentProofDetected: true, paymentProofAt: hoursAgo(2), lastMessageAt: hoursAgo(2) } });
  await db.message.create({ data: { tenantId: DSP, conversationId: conv.id, direction: 'INBOUND', sender: 'CONTACT', type: 'IMAGE', content: '[Image]', sentAt: hoursAgo(2) } });
  await db.message.create({ data: { tenantId: DSP, conversationId: conv.id, direction: 'OUTBOUND', sender: 'AI', type: 'TEXT', content: 'Payment received — form link…', sentAt: hoursAgo(2) } });
  await db.automationRule.create({ data: { id: 'rule-welcome', tenantId: DSP, name: 'Mastery: Welcome to the dashboard', enabled: true, enabledAt: hoursAgo(72),
    trigger: { type: 'mastery_event', event: 'enrolled', delay: 0, unit: 'minutes' }, condition: {},
    action: { type: 'send_whatsapp', template: `Welcome to AI Agent Mastery, {name}! 🎓 Join the DSP WhatsApp group: ${GROUP_LINK}` } } });
  return { contact, lead, conv };
};

test('Mastery admin approval → webhook → CLOSED_WON → welcome WhatsApp with the group invite', async () => {
  const { contact, lead, conv } = await seed();

  // 1. The course posts `enrolled` (phone in the form's "+92 300 1234567" shape, no email on file).
  const res = await request(app).post('/webhooks/mastery').set('x-mastery-secret', 'events-secret').set('content-type', 'application/json')
    .send(JSON.stringify({ event: 'enrolled', email: 'ali@example.com', data: { phone: '+92 300 1234567', full_name: 'Ali Raza', fee: 28000, currency: 'PKR', source: 'mastery_admin' } }));
  assert.equal(res.status, 200, res.text);

  // 2. The existing WhatsApp lead (matched by phone) is now CLOSED_WON — not a duplicate.
  const leads = await db.lead.findMany({ where: { tenantId: DSP, contactId: contact.id } });
  assert.equal(leads.length, 1, 'no duplicate lead');
  assert.equal(leads[0].id, lead.id);
  assert.equal(leads[0].stage, 'CLOSED_WON');
  assert.equal(leads[0].product, 'MASTERY');
  assert.equal(Number(leads[0].enrollmentFee), 28000);
  const updatedContact = await db.contact.findUnique({ where: { id: contact.id } });
  assert.equal(updatedContact.email, 'ali@example.com');

  // 3. The payment thread is closed out (no longer "proof to verify" in /today).
  const thread = await db.conversation.findUnique({ where: { id: conv.id } });
  assert.equal(thread.status, 'CLOSED');
  assert.equal(thread.aiEnabled, false);

  // 4. The event the automation engine reads: a SYSTEM activity with masteryEvent=enrolled.
  const sys = await db.activity.findMany({ where: { tenantId: DSP, leadId: lead.id, type: 'SYSTEM', metadata: { path: ['masteryEvent'], equals: 'enrolled' } } });
  assert.equal(sys.length, 1, 'SYSTEM activity for the mastery_event trigger');
  // …and the STAGE_CHANGE row for analytics is still there.
  const stageRows = await db.activity.findMany({ where: { tenantId: DSP, leadId: lead.id, type: 'STAGE_CHANGE' } });
  assert.equal(stageRows.length, 1);

  // 5. The next automation tick sends the welcome (lead is CLOSED_WON, thread CLOSED — a lifecycle rule must still reach them).
  const rule = await db.automationRule.findUnique({ where: { id: 'rule-welcome' } });
  const matches = await automationService.findMatches(rule);
  assert.equal(matches.length, 1, 'welcome rule matches the newly enrolled student');
  assert.equal(matches[0].lead.id, lead.id);
  assert.equal(matches[0].insideWindow, true, 'student sent the screenshot 2h ago — inside the 24h window');

  const summary = await automationService.runTenant(DSP);
  assert.equal(summary.sent, 1, JSON.stringify(summary));

  const outbound = await db.message.findMany({ where: { tenantId: DSP, conversationId: conv.id, direction: 'OUTBOUND', sender: 'SYSTEM' } });
  assert.equal(outbound.length, 1);
  assert.match(outbound[0].content, /Welcome to AI Agent Mastery, Ali!/);
  assert.ok(outbound[0].content.includes(GROUP_LINK), 'welcome carries the group invite');
  assert.equal(outbound[0].status, 'SENT');

  const run = await db.automationRun.findFirst({ where: { ruleId: 'rule-welcome', leadId: lead.id } });
  assert.equal(run.status, 'SENT');

  // 6. Idempotent: a second tick sends nothing (once-per-lead guard).
  const again = await automationService.runTenant(DSP);
  assert.equal(again.sent, 0);
});

test('a non-list-price enrolment is held at PROPOSED and does not fire the welcome', async () => {
  const contact = await db.contact.create({ data: { tenantId: DSP, phone: '923009999999', name: 'Sana' } });
  const lead = await db.lead.create({ data: { tenantId: DSP, contactId: contact.id, stage: 'QUALIFYING', product: 'MASTERY' } });
  const res = await request(app).post('/webhooks/mastery').set('x-mastery-secret', 'events-secret').set('content-type', 'application/json')
    .send(JSON.stringify({ event: 'enrolled', email: 'sana@example.com', data: { phone: '923009999999', fee: 15000, currency: 'PKR' } }));
  assert.equal(res.status, 200);
  const updated = await db.lead.findUnique({ where: { id: lead.id } });
  assert.equal(updated.stage, 'PROPOSED');
  const sys = await db.activity.findMany({ where: { leadId: lead.id, type: 'SYSTEM' } });
  assert.equal(sys.length, 0, 'no welcome event for an unverified amount');
});

test('wrong secret is rejected', async () => {
  const res = await request(app).post('/webhooks/mastery').set('x-mastery-secret', 'nope').set('content-type', 'application/json')
    .send(JSON.stringify({ event: 'enrolled', email: 'x@y.com' }));
  assert.equal(res.status, 401);
});
