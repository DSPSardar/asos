#!/usr/bin/env node
// marketing/pipeline/daily-post.js
// Unattended daily poster — runs from launchd (see marketing/CLAUDE.md "Automated daily
// posting") with NO human review. Because nobody approves the text before it goes live,
// this script is deliberately paranoid:
//
//   1. Runs the content chain fresh (scout → planner), picks the calendar item matching
//      TODAY's weekday (the weekly cycle repeats, so weekday-matching keeps phase alignment:
//      awareness Mon–Wed, proof Thu–Fri, enrollment Sat–Sun).
//   2. Generates hooks → content → repurposed channel copy.
//   3. Hard gates before publishing:
//        a. placeholder gate — refuses text containing TODO/PLACEHOLDER/bracket markers.
//        b. Verifier agent (agents/09-verifier.md) — adversarial fact-check against
//           knowledge/dsp/; any unsupported claim (invented students/events/numbers,
//           prices, fake urgency, wrong-day "tonight" claims) blocks the post.
//   4. Publishes the LinkedIn post only if every gate passes; logs either way to
//      output/dsp/<date>/published.md.
//
// A blocked day posts NOTHING — silence is always safer than an invented claim.
//
// Env: DAILY_POST_DRY_RUN=1 runs everything except the actual publish.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL, MAX_TOKENS, PATHS } = require('./config');
const { runAgentStep, loadKnowledge, loadAgentPrompt, extractJson } = require('./agentRunner');
const { publishLinkedInPost } = require('./linkedin');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayDir() {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(PATHS.output, date);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveStep(dir, step, json) {
  fs.writeFileSync(path.join(dir, `${step}.json`), JSON.stringify(json, null, 2));
}

function appendLog(dir, lines) {
  fs.appendFileSync(path.join(dir, 'published.md'), lines.join('\n') + '\n');
}

// Gate (a): no unfilled placeholders may ever reach a live post.
function placeholderProblems(text) {
  const problems = [];
  if (/TODO/i.test(text)) problems.push('contains "TODO"');
  if (/PLACEHOLDER/i.test(text)) problems.push('contains "PLACEHOLDER"');
  if (/\[[^\]]*\]/.test(text)) problems.push('contains bracketed marker like [BOOKING LINK]');
  return problems;
}

// Gate (b): adversarial fact-check by the Verifier agent.
async function verify(anthropic, postText) {
  const systemPrompt = loadAgentPrompt('09-verifier.md');
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekday = WEEKDAYS[new Date().getDay()];
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        `## Today's date\n\n${todayIso} (${weekday})`,
        `## knowledge/dsp/\n\n${loadKnowledge()}`,
        `## Content to verify\n\n${postText}`,
      ].join('\n\n---\n\n'),
    }],
  });
  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return extractJson(text);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const dir = todayDir();
  const dryRun = process.env.DAILY_POST_DRY_RUN === '1';
  const weekday = WEEKDAYS[new Date().getDay()];

  console.log(`[daily-post] ${new Date().toISOString()} — generating for ${weekday}${dryRun ? ' (DRY RUN)' : ''}`);

  const scout = await runAgentStep('scout', null, anthropic);
  saveStep(dir, 'scout', scout);

  const planner = await runAgentStep('planner', scout, anthropic);
  saveStep(dir, 'planner', planner);

  // Weekday-match today against the calendar (dates in the plan may be next week's — the
  // cycle repeats weekly, so the weekday's phase and angle are what matter).
  const item = (planner.days || []).find((d) => d.day === weekday);
  if (!item) throw new Error(`Planner output has no calendar item for ${weekday}`);
  console.log(`[daily-post] today's item: [${item.cycle_phase}] ${item.platform} — ${item.content_goal.slice(0, 80)}`);

  const hooks = await runAgentStep('hook-writer', { calendar_item: item }, anthropic);
  saveStep(dir, 'hook-writer', hooks);

  const asset = await runAgentStep('content-writer', { calendar_item: item, hooks }, anthropic);
  saveStep(dir, 'content-writer', asset);

  const repurposed = await runAgentStep('repurposer', asset, anthropic);
  saveStep(dir, 'repurposer', repurposed);

  const postText = repurposed.linkedin_post;
  if (!postText) throw new Error('Repurposer output has no linkedin_post');

  // ── Gates ──
  const placeholderIssues = placeholderProblems(postText);
  if (placeholderIssues.length) {
    appendLog(dir, [`## LinkedIn — BLOCKED (placeholder gate) — ${new Date().toISOString()}`, ...placeholderIssues.map((p) => `- ${p}`), '']);
    console.error('[daily-post] BLOCKED by placeholder gate:', placeholderIssues.join('; '));
    process.exit(2);
  }

  const verdict = await verify(anthropic, postText);
  saveStep(dir, 'verifier', verdict);
  if (!verdict.approved) {
    appendLog(dir, [
      `## LinkedIn — BLOCKED (verifier) — ${new Date().toISOString()}`,
      ...(verdict.violations || []).map((v) => `- "${v.claim}" — ${v.problem}`),
      '',
    ]);
    console.error('[daily-post] BLOCKED by verifier:', JSON.stringify(verdict.violations));
    process.exit(2);
  }

  if (dryRun) {
    console.log('[daily-post] DRY RUN — gates passed, would have posted:\n\n' + postText);
    return;
  }

  const result = await publishLinkedInPost(postText);
  appendLog(dir, [
    `## LinkedIn — ${result.postUrn}`,
    `- **Posted:** ${new Date().toISOString()} (automated daily post, verifier-approved)`,
    `- **Calendar item:** ${weekday} [${item.cycle_phase}] — ${item.content_goal}`,
    '',
    '```',
    postText,
    '```',
    '',
  ]);
  console.log(`[daily-post] PUBLISHED: ${result.postUrn}`);
}

main().catch((err) => {
  console.error('[daily-post] FAILED:', err.response?.data || err.message || err);
  process.exit(1);
});
