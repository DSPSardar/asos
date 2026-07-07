#!/usr/bin/env node
// marketing/pipeline/dm-manager.js
// Standalone: scores one inbound DM/comment and, if hot/warm, creates the real Contact +
// Lead via leadsClient.js (businessUnit: "DSP").
//
// Usage:
//   npm run marketing:dm -- --message="how do I join the next batch?"

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL, MAX_TOKENS, PATHS } = require('./config');
const { submitLeadHandoff } = require('./leadsClient');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=([\s\S]*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  return JSON.parse(raw.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.message) {
    console.error('Usage: npm run marketing:dm -- --message="<inbound DM text>"');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY must be set in the environment (see marketing/.env.example).');
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = fs.readFileSync(path.join(PATHS.agents, '06-dm-manager.md'), 'utf8');

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: args.message }],
  });

  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  const handoff = extractJson(text);

  console.log(JSON.stringify(handoff, null, 2));

  if (handoff.lead_score === 'hot' || handoff.lead_score === 'warm') {
    if (!handoff.contact?.phone) {
      console.warn('Lead scored hot/warm but no phone was extracted — skipping API handoff. Provide phone context manually.');
      return;
    }
    try {
      const { contact, lead } = await submitLeadHandoff(handoff);
      console.log(`✓ Created lead ${lead.id} for contact ${contact.id} (businessUnit: DSP)`);
    } catch (err) {
      // axios connection failures often have an empty .message — fall through to .code
      // (e.g. ECONNREFUSED) so the error is actually actionable.
      const detail = err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message || err.code || String(err);
      console.error(`Failed to create lead in backend (${process.env.MARKETING_API_BASE_URL || 'http://localhost:3000/api/v1'}):`, detail);
      console.error('Is the ASOS backend running and are MARKETING_API_EMAIL/PASSWORD correct in marketing/.env?');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
