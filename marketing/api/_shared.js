// marketing/api/_shared.js
// Shared helpers for the serverless API. Files prefixed with "_" are NOT exposed as
// routes by Vercel — this is a plain module.

const Anthropic = require('@anthropic-ai/sdk');

// Auth: same shared-secret scheme api/run.js established. Returns true if the request
// may proceed; otherwise writes the error response and returns false.
function requireAuth(req, res) {
  const secret = process.env.MARKETING_TRIGGER_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'MARKETING_TRIGGER_SECRET is not configured on the server.' });
    return false;
  }
  if (req.headers['x-trigger-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized — check the API secret in Settings.' });
    return false;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    return false;
  }
  return true;
}

function anthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function methodGuard(req, res, method = 'POST') {
  if (req.method !== method) {
    res.status(405).json({ error: `Method not allowed. Use ${method}.` });
    return false;
  }
  return true;
}

module.exports = { requireAuth, anthropicClient, methodGuard };
