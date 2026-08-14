// test/payment-proof-classification.test.js
//
// Regression guard for the bug reported in production: a lead sent a
// screenshot of the refund policy (not a receipt) after payment
// instructions had gone out, and conversation.worker.js's old
// type+timing-only check auto-confirmed it as payment received. The fix
// added classifyPaymentProofImage() as a real content check before that
// confirmation is allowed to fire — this file tests that function directly.
//
// Two things are verified:
//   1. Fail-closed: when the classification call cannot complete (here,
//      because this sandbox has no network route to api.openai.com — the
//      exact same failure shape as a real outage or bad key), the function
//      must return isPaymentProof:false, never throw and never silently
//      default to "trust it."
//   2. Correct branching: given a canned model response, the function
//      forwards isPaymentProof/reason as-is rather than transforming or
//      dropping them.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/db';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);
process.env.OPENAI_API_KEY ||= 'sk-test';

const fakeBuffer = Buffer.from('not a real image, just needs to be bytes');

test('fails closed when the classification call cannot complete', async () => {
  // No network route to api.openai.com in this environment — the real SDK
  // call below will error out exactly as it would on a bad key, a timeout,
  // or a model outage in production. That failure IS the test: it proves
  // the catch branch in classifyPaymentProofImage runs and returns the
  // safe default rather than throwing past the worker or defaulting true.
  const { classifyPaymentProofImage } = require('../src/services/claude.service');

  const result = await classifyPaymentProofImage(fakeBuffer, 'image/jpeg');

  assert.equal(result.isPaymentProof, false);
  assert.equal(result.reason, 'classification_failed');
});

test('forwards a true classification from the model without altering it', async () => {
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'openai') {
      class FakeOpenAI {
        chat = {
          completions: {
            create: async () => ({
              choices: [{
                message: {
                  content: JSON.stringify({ isPaymentProof: true, reason: 'Bank transfer receipt with amount and reference number' }),
                },
              }],
            }),
          },
        };
      }
      return FakeOpenAI;
    }
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../src/services/claude.service')];
  const { classifyPaymentProofImage } = require('../src/services/claude.service');

  const result = await classifyPaymentProofImage(fakeBuffer, 'image/jpeg');

  Module._load = originalLoad;
  delete require.cache[require.resolve('../src/services/claude.service')];

  assert.equal(result.isPaymentProof, true);
  assert.equal(result.reason, 'Bank transfer receipt with amount and reference number');
});

test('forwards a false classification from the model — the exact production failure', async () => {
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'openai') {
      class FakeOpenAI {
        chat = {
          completions: {
            create: async () => ({
              choices: [{
                message: {
                  content: JSON.stringify({ isPaymentProof: false, reason: 'This is a screenshot of website text (refund policy), not a payment receipt' }),
                },
              }],
            }),
          },
        };
      }
      return FakeOpenAI;
    }
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../src/services/claude.service')];
  const { classifyPaymentProofImage } = require('../src/services/claude.service');

  const result = await classifyPaymentProofImage(fakeBuffer, 'image/jpeg');

  Module._load = originalLoad;
  delete require.cache[require.resolve('../src/services/claude.service')];

  assert.equal(result.isPaymentProof, false);
  assert.match(result.reason, /refund policy/);
});
