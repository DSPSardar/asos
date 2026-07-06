#!/usr/bin/env node
// marketing/pipeline/run.js
// Sequential Anthropic API pipeline: scout -> planner -> hook-writer -> content-writer ->
// repurposer. Each agent's .md file is the system prompt; knowledge/dsp/ files + the
// previous step's output are injected into the user message.
//
// Usage:
//   npm run marketing -- --step=all
//   npm run marketing -- --step=scout

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL, MAX_TOKENS, PATHS, KNOWLEDGE_FILES, PIPELINE_STEPS } = require('./config');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function loadKnowledge() {
  return KNOWLEDGE_FILES
    .map((name) => {
      const content = readFileIfExists(path.join(PATHS.knowledge, name));
      return `## ${name}\n\n${content}`;
    })
    .join('\n\n---\n\n');
}

function loadAgentPrompt(agentFile) {
  const content = readFileIfExists(path.join(PATHS.agents, agentFile));
  if (!content) throw new Error(`Agent file not found: ${agentFile}`);
  return content;
}

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  return JSON.parse(raw.trim());
}

function todayDir() {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(PATHS.output, date);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function runStep({ step, agentFile }, previousOutput, anthropic) {
  const systemPrompt = loadAgentPrompt(agentFile);
  const knowledge = loadKnowledge();

  const userMessageParts = [`## knowledge/dsp/\n\n${knowledge}`];
  if (previousOutput !== null) {
    userMessageParts.push(`## Input from previous step\n\n${JSON.stringify(previousOutput, null, 2)}`);
  } else {
    userMessageParts.push(
      `## Niche\n\nAI agents training, careers with AI, freelancing with AI, Pakistan + diaspora.`
    );
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessageParts.join('\n\n---\n\n') }],
  });

  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  const json = extractJson(text);

  const dir = todayDir();
  fs.writeFileSync(path.join(dir, `${step}.json`), JSON.stringify(json, null, 2));
  fs.writeFileSync(
    path.join(dir, `${step}.md`),
    `# ${step}\n\nGenerated ${new Date().toISOString()}\n\n\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\`\n`
  );

  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requestedStep = args.step || 'all';

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY must be set in the environment (see marketing/.env.example).');
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const startIndex = requestedStep === 'all'
    ? 0
    : PIPELINE_STEPS.findIndex((s) => s.step === requestedStep);

  if (startIndex === -1) {
    console.error(
      `Unknown step "${requestedStep}". Valid steps: all, ${PIPELINE_STEPS.map((s) => s.step).join(', ')}`
    );
    process.exit(1);
  }

  const stepsToRun = requestedStep === 'all' ? PIPELINE_STEPS : [PIPELINE_STEPS[startIndex]];

  // A single non-first step needs the prior step's output as input — load it from today's
  // output dir rather than silently falling back to the niche prompt meant for Scout only.
  let previousOutput = null;
  if (startIndex > 0) {
    const priorStep = PIPELINE_STEPS[startIndex - 1].step;
    const priorPath = path.join(PATHS.output, new Date().toISOString().slice(0, 10), `${priorStep}.json`);
    if (!fs.existsSync(priorPath)) {
      console.error(
        `Running "${requestedStep}" alone requires today's "${priorStep}.json" in output/dsp/. Run --step=${priorStep} first, or --step=all.`
      );
      process.exit(1);
    }
    previousOutput = JSON.parse(fs.readFileSync(priorPath, 'utf8'));
  }

  for (const stepDef of stepsToRun) {
    console.log(`→ running ${stepDef.step}...`);
    previousOutput = await runStep(stepDef, previousOutput, anthropic);
    console.log(`✓ ${stepDef.step} done — output/dsp/${new Date().toISOString().slice(0, 10)}/${stepDef.step}.json`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
