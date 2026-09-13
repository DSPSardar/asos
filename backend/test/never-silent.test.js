// test/never-silent.test.js
//
// Item 4 — no inbound message may end with zero outbound. Inside the 24h
// window a blank reply gets the holding line + one retry; outside it, the
// approved re-open template. Every occurrence logs ev "never-silent".
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ns = require('../src/services/agent-guards/never-silent');

const now = new Date('2026-09-13T10:00:00Z');
const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000);
const tpl = { name: 'dsp_reopen_generic', language: 'en', bodyParams: ['{name}'] };

test('a normal reply inside the window is sent as-is', () => {
  const p = ns.planNeverSilent({ reply: 'Fee PKR 28,000 hai.', lastInboundAt: hoursAgo(1), now, reopenTemplate: tpl });
  assert.equal(p.action, 'send');
  assert.equal(p.text, 'Fee PKR 28,000 hai.');
});

test('a blank / blocked reply inside the window → holding line, then one retry', () => {
  for (const blank of ['', '   ', null, undefined]) {
    const p = ns.planNeverSilent({ reply: blank, lastInboundAt: hoursAgo(2), now, reopenTemplate: tpl });
    assert.equal(p.action, 'hold_and_retry');
    assert.equal(p.text, 'Thanks — let me check that for you, one moment.');
    assert.equal(p.reason, 'blank_reply');
  }
});

test('outside the 24h window the approved re-open template goes out instead of free text', () => {
  const p = ns.planNeverSilent({ reply: 'anything', lastInboundAt: hoursAgo(30), now, reopenTemplate: tpl });
  assert.equal(p.action, 'template');
  assert.equal(p.template.name, 'dsp_reopen_generic');
  const blank = ns.planNeverSilent({ reply: '', lastInboundAt: hoursAgo(30), now, reopenTemplate: tpl });
  assert.equal(blank.action, 'template');
  assert.equal(blank.reason, 'outside_24h_blank_reply');
});

test('outside the window with no template configured is reported, never silently dropped', () => {
  const p = ns.planNeverSilent({ reply: '', lastInboundAt: hoursAgo(48), now, reopenTemplate: null });
  assert.equal(p.action, 'no_template');
  assert.match(p.reason, /no_template/);
});

test('window edge: 23h59 is inside, 24h01 is outside; unknown last-inbound counts as outside', () => {
  assert.equal(ns.isInsideWindow(new Date(now.getTime() - (24 * 60 - 1) * 60_000), now), true);
  assert.equal(ns.isInsideWindow(new Date(now.getTime() - (24 * 60 + 1) * 60_000), now), false);
  assert.equal(ns.isInsideWindow(null, now), false);
  assert.equal(ns.isInsideWindow('not a date', now), false);
});

test('the re-open template is read from tenant.settings.reopenTemplate', () => {
  assert.equal(ns.reopenTemplateFor({ settings: {} }), null);
  assert.equal(ns.reopenTemplateFor({ settings: { reopenTemplate: { language: 'en' } } }), null);
  assert.deepEqual(ns.reopenTemplateFor({ settings: { reopenTemplate: { name: 'dsp_reopen' } } }), { name: 'dsp_reopen', language: 'en', bodyParams: ['{name}'] });
});

test('the worker wraps every outbound path in the never-silent deliverer and logs ev "never-silent"', () => {
  const src = require('fs').readFileSync(require.resolve('../src/workers/conversation.worker'), 'utf8');
  assert.equal(ns.EV, 'never-silent');
  assert.match(src, /ev: neverSilent\.EV/);
  // continue path, handoff farewell, AI-error handoff, token-limit handoff
  assert.ok((src.match(/deliverWithNeverSilent\(\{/g) || []).length >= 5, 'deliverWithNeverSilent used on every reply path');
  // the retry re-runs the pipeline on a shorter context
  assert.match(src, /\.slice\(-6\)/);
  // a bare sendAndSaveReply for the AI's main reply no longer exists
  assert.doesNotMatch(src, /await sendAndSaveReply\(\{\s*tenant, conversation, tenantId,\s*phone: normalizedPhone,\s*content: aiResult\.reply/);
});
