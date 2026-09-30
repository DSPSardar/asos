// test/prompt-caching.test.js
//
// Token burn: a stable prompt_cache_key per tenant+agent, the rolling summary
// placed AFTER the system prompt (cache prefix intact), the Closer's phase
// count from the whole thread, cached tokens logged, and metering that
// discounts cached input the way the provider bills it.
'use strict';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-only-value-not-a-real-secret-0000';
process.env.JWT_REFRESH_SECRET ||= 'test-only-value-not-a-real-secret-1111';
process.env.OPENAI_API_KEY ||= 'sk-test-placeholder-not-a-real-key';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { installFakePrisma } = require('./_fakePrisma');
const db = installFakePrisma();

const calls = [];
const usage = { prompt_tokens: 5000, completion_tokens: 200, total_tokens: 5200, prompt_tokens_details: { cached_tokens: 4000 } };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'openai') {
    return class FakeOpenAI {
      chat = { completions: { create: async (args) => {
        calls.push(args);
        const sys = args.messages[0].content;
        const content = /QUALIFIER AGENT/.test(sys)
          ? JSON.stringify({ lead_status: 'WARM', score: 6, intent: 'medium', problem_summary: 'p', next_action: 'continue_qualifying', is_enrollment_confirmed: false, sentiment: 'NEUTRAL', signal_type: 'NONE' })
          : /CRM assistant|running summary/i.test(sys) ? 'rolled summary'
            : JSON.stringify({ reply_message: 'Ji bilkul!', closing_type: 'soft', urgency_trigger: '', knowledge_gap: '', send_payment_details: false });
        return { choices: [{ message: { content } }], usage };
      } } };
    };
  }
  return originalLoad.apply(this, arguments);
};
const claude = require('../src/services/claude.service');
Module._load = originalLoad;

const lead = { id: 'l1', tenantId: 't1', stage: 'QUALIFYING', aiScore: 50, scoreLabel: 'WARM', qualificationData: {} };
const contact = { id: 'k1', name: 'Ayesha' };
const conversation = { id: 'c1' };
const hist = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, sender: i % 2 ? 'AI' : 'CONTACT', content: `msg ${i + 1}` }));
const run = (over = {}) => claude.processMessage({ tenantId: 't1', lead, contact, conversation, newMessage: 'fee?', messageHistory: hist(10), ...over });
const qualifierCall = () => calls.find((c) => /QUALIFIER AGENT/.test(c.messages[0].content));
const closerCall = () => calls.find((c) => !/QUALIFIER AGENT/.test(c.messages[0].content));

beforeEach(() => {
  for (const t of Object.values(db._tables)) t.length = 0;
  calls.length = 0;
  db._tables.aiConfig.push({ tenantId: 't1', systemPrompt: 'PRODUCT: AI Agent Mastery. Fee PKR 28,000.', handoffRules: {} });
  db._tables.subscription.push({ tenantId: 't1', aiTokensUsed: 0n, aiTokensLimit: 1000000n });
});

test('meteredTokens: uncached input + 10% of cached input (rounded up) + output', () => {
  assert.equal(claude.meteredTokens(usage), 1000 + 400 + 200);
  assert.equal(claude.meteredTokens({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 7 } }), 93 + 1 + 5);
  assert.equal(claude.meteredTokens({ prompt_tokens: 100, completion_tokens: 5 }), 105);   // no cache info → full price
  assert.equal(claude.meteredTokens(undefined), 0);
});

test('every agent call carries a stable per-tenant, per-agent prompt_cache_key', async () => {
  await run();
  assert.equal(qualifierCall().prompt_cache_key, 'asos:t1:qualifier');
  assert.equal(closerCall().prompt_cache_key, 'asos:t1:closer');
});

test('the rolling summary goes AFTER the system prompt — the cached prefix is byte-identical', async () => {
  await run();
  const plainQ = qualifierCall().messages[0].content;
  const plainC = closerCall().messages[0].content;
  calls.length = 0;
  await run({ earlierSummary: 'Lead is a student in Lahore, asked about fee twice.' });
  assert.equal(qualifierCall().messages[0].content, plainQ);
  assert.equal(closerCall().messages[0].content, plainC);
  for (const c of [qualifierCall(), closerCall()]) {
    assert.equal(c.messages[1].role, 'user');
    assert.match(c.messages[1].content, /^Earlier in this conversation \(summary/);
    assert.match(c.messages[1].content, /student in Lahore/);
  }
});

test('with a summary the agents see the whole loaded window (no gap); without, the old 15/20 slices', async () => {
  await run({ messageHistory: hist(28) });
  assert.equal(qualifierCall().messages.length, 1 + 15 + 1);
  assert.equal(closerCall().messages.length, 1 + 20 + 1);
  calls.length = 0;
  await run({ messageHistory: hist(28), earlierSummary: 'S' });
  assert.equal(qualifierCall().messages.length, 1 + 1 + 28 + 1);
  assert.equal(closerCall().messages.length, 1 + 1 + 28 + 1);
});

test("Closer phase count comes from the whole thread's lead messages, not the window", async () => {
  await run({ messageHistory: hist(20), contactMessageCount: 60 });
  assert.match(closerCall().messages[0].content, /Lead messages so far \(including this one\): 61/);
  calls.length = 0;
  await run({ messageHistory: hist(20) });                 // legacy callers: count the window
  assert.match(closerCall().messages[0].content, /Lead messages so far \(including this one\): 11/);
});

test('cached tokens are logged per agent; the subscription is metered at the discounted rate', async () => {
  const r = await run();
  const log = db._tables.aiAgentLog[0];
  assert.equal(log.qualifierTokens, 5200);                 // raw totals stay raw
  assert.equal(log.closerTokens, 5200);
  assert.equal(log.qualifierCachedTokens, 4000);
  assert.equal(log.closerCachedTokens, 4000);
  assert.equal(Number(db._tables.subscription[0].aiTokensUsed), 2 * 1600);
  assert.equal(r.tokensUsed, 10400);
  assert.equal(r.meteredTokens, 3200);
});

test('rolling generateSummary folds the prior summary in and meters its own tokens', async () => {
  const text = await claude.generateSummary({ tenantId: 't1', messageHistory: hist(12), priorSummary: 'Earlier: asked fee.', rolling: true });
  assert.equal(text, 'rolled summary');
  const c = calls.at(-1);
  assert.equal(c.prompt_cache_key, 'asos:t1:summary');
  assert.match(c.messages[1].content, /Earlier: asked fee\./);
  assert.equal(c.messages.length, 1 + 1 + 12);             // not cut to the UI's last 30
  assert.equal(Number(db._tables.subscription[0].aiTokensUsed), 1600);
});

test('UI generateSummary (non-rolling) keeps its contract and is not metered', async () => {
  const text = await claude.generateSummary({ tenantId: 't1', messageHistory: hist(40) });
  assert.equal(typeof text, 'string');
  assert.equal(calls.at(-1).messages.length, 1 + 30);
  assert.equal(Number(db._tables.subscription[0].aiTokensUsed), 0);
});
