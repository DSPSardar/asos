// marketing/pipeline/agentRunner.js
// Pure "call one agent" logic — no filesystem writes, no CLI concerns. Shared by the local
// CLI (run.js, which persists output to disk) and the Vercel serverless trigger (api/run.js,
// which has no durable local filesystem and returns the result in the HTTP response instead).

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL, MAX_TOKENS, PATHS, KNOWLEDGE_FILES, PIPELINE_STEPS } = require('./config');

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

function findStepDef(step) {
  const stepDef = PIPELINE_STEPS.find((s) => s.step === step);
  if (!stepDef) {
    throw Object.assign(
      new Error(`Unknown step "${step}". Valid steps: ${PIPELINE_STEPS.map((s) => s.step).join(', ')}`),
      { statusCode: 400 }
    );
  }
  return stepDef;
}

// Runs exactly one agent step against the Anthropic API and returns its parsed JSON output.
// `previousOutput` is the prior step's JSON (or null for the first step, scout) — the caller
// is responsible for sourcing it (from disk for the CLI, from the request body for the API).
// Malformed JSON from the model (occasional LLM slip, e.g. an unescaped quote) gets ONE
// automatic re-roll before failing — unattended runs shouldn't die on a coin flip.
async function runAgentStep(step, previousOutput, anthropic, attempt = 1) {
  const { agentFile } = findStepDef(step);
  const systemPrompt = loadAgentPrompt(agentFile);
  const knowledge = loadKnowledge();

  const todayIso = new Date().toISOString().slice(0, 10);
  const userMessageParts = [
    `## Today's date\n\n${todayIso}`,
    `## knowledge/dsp/\n\n${knowledge}`,
  ];
  if (previousOutput !== null && previousOutput !== undefined) {
    userMessageParts.push(`## Input from previous step\n\n${JSON.stringify(previousOutput, null, 2)}`);
  } else {
    userMessageParts.push(
      `## Niche\n\nAI agents training, careers with AI, freelancing with AI, Pakistan + diaspora.`
    );
  }

  // Scout gets live web search so "trend research" is actual research, not the model
  // guessing from training data. Server-side tool — Anthropic runs the searches and the
  // model reads results before producing its ranked opportunities. Other agents stay
  // search-free: their inputs are the knowledge files + the previous step's output.
  const useWebSearch = step === 'scout' && process.env.SCOUT_WEB_SEARCH !== '0';

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessageParts.join('\n\n---\n\n') }],
    ...(useWebSearch && {
      // max_uses caps how many searches Scout can run per morning — fewer searches means
      // fewer full-page results loaded into context, which is most of what drove output
      // tokens up (not the final JSON itself).
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    }),
  });

  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  try {
    return extractJson(text);
  } catch (err) {
    if (message.stop_reason === 'max_tokens') {
      throw new Error(
        `${step}: response was cut off at MAX_TOKENS (${MAX_TOKENS}) before the JSON closed. ` +
        `Raise MAX_TOKENS in pipeline/config.js.`
      );
    }
    if (attempt < 2) {
      console.error(`[agentRunner] ${step}: malformed JSON (${err.message}) — retrying once.`);
      return runAgentStep(step, previousOutput, anthropic, attempt + 1);
    }
    throw new Error(`${step}: model returned malformed JSON twice — ${err.message}`);
  }
}

module.exports = { runAgentStep, findStepDef, loadKnowledge, loadAgentPrompt, extractJson };
