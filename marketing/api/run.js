// marketing/api/run.js
// Vercel serverless entrypoint — runs ONE content-pipeline step per invocation and returns
// its JSON in the response. Deliberately one-step-per-call, not "--step=all" in one request:
// Vercel functions are stateless (no shared/durable local filesystem across invocations) and
// time-limited, and five sequential Claude calls in one request risks the platform timeout.
// The caller (cron, script, or you manually) chains steps by passing the previous step's
// output back in as `previousOutput`.
//
// POST /api/run
// Headers: x-trigger-secret: <MARKETING_TRIGGER_SECRET>
// Body:    { "step": "scout" }
//          { "step": "planner", "previousOutput": { ...scout output... } }

const Anthropic = require('@anthropic-ai/sdk');
const { runAgentStep } = require('../pipeline/agentRunner');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const secret = process.env.MARKETING_TRIGGER_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'MARKETING_TRIGGER_SECRET is not configured on the server.' });
    return;
  }
  if (req.headers['x-trigger-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    return;
  }

  const { step, previousOutput } = req.body || {};
  if (!step) {
    res.status(400).json({ error: '"step" is required in the request body.' });
    return;
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const output = await runAgentStep(step, previousOutput ?? null, anthropic);
    res.status(200).json({ step, output, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};
