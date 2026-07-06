#!/usr/bin/env node
// marketing/pipeline/analyst.js
// Standalone: reads a metrics CSV, produces weekly-report.md, and appends the top 3 posts
// to knowledge/dsp/winners.md.
//
// Usage:
//   npm run marketing:analyst -- --metrics=path/to/metrics.csv

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL, MAX_TOKENS, PATHS } = require('./config');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  return JSON.parse(raw.trim());
}

function extractReport(text) {
  const fenced = text.match(/```markdown\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.replace(/```json[\s\S]*?```/i, '').trim();
}

function appendWinners(topPosts) {
  const winnersPath = path.join(PATHS.knowledge, 'winners.md');
  const rows = topPosts
    .map((p) => `| ${p.date} | ${p.platform} | ${p.hook.replace(/\|/g, '\\|')} | ${p.format} | ${p.metric} | ${p.why_it_worked.replace(/\|/g, '\\|')} |`)
    .join('\n');
  fs.appendFileSync(winnersPath, `\n${rows}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.metrics) {
    console.error('Usage: npm run marketing:analyst -- --metrics=path/to/metrics.csv');
    process.exit(1);
  }
  if (!fs.existsSync(args.metrics)) {
    console.error(`Metrics file not found: ${args.metrics}`);
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY must be set in the environment (see marketing/.env.example).');
    process.exit(1);
  }

  const csv = fs.readFileSync(args.metrics, 'utf8');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = fs.readFileSync(path.join(PATHS.agents, '08-analyst.md'), 'utf8');

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `## Metrics CSV\n\n\`\`\`csv\n${csv}\n\`\`\`\n\nProduce the weekly report as a fenced \`\`\`markdown block, followed by the structured JSON as a fenced \`\`\`json block.`,
    }],
  });

  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  const report = extractReport(text);
  const json = extractJson(text);

  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(PATHS.output, date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'weekly-report.md'), report);
  fs.writeFileSync(path.join(dir, 'analyst.json'), JSON.stringify(json, null, 2));

  if (json.top_posts?.length) {
    appendWinners(json.top_posts);
  }

  console.log(`✓ weekly-report.md written to output/dsp/${date}/`);
  console.log(`✓ ${json.top_posts?.length || 0} posts appended to knowledge/dsp/winners.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
