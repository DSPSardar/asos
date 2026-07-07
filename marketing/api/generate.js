// marketing/api/generate.js
// One endpoint, four generators. Each mode wraps a purpose-built prompt around the same
// grounded-knowledge pattern the pipeline agents use.
//
// POST /api/generate   headers: x-trigger-secret
// body: { "mode": "campaign"|"social_post"|"ad_copy"|"funnel", "brief": "...", "options": {...} }
// resp: { "mode", "output" }  — output is markdown text ready to display/copy
//
// NOTE: "campaign" here is the quick single-call generator for the dashboard. The full
// 5-agent pipeline (scout→…→repurposer) is still available step-by-step via /api/run —
// the Campaign Generator page uses THAT for real campaigns and this only for quick drafts.

const { MODEL, MAX_TOKENS } = require('../pipeline/config');
const { loadKnowledge } = require('../pipeline/agentRunner');
const { requireAuth, anthropicClient, methodGuard } = require('./_shared');

const COMMON_RULES = `
HARD RULES:
- Factual claims about DSP must trace to the knowledge files below. Never invent students,
  results, counts, or events. Structural facts (browser-only, no Python, Mon–Fri 9–10 PM PKT
  live, Sat build, Sun showcase, new batch every Monday, ~30 seats, instructor: 24 years IT,
  Google Certified AI Agentic Trainer) are safe.
- Never state a price. If a CTA needs pricing, route to "DM for details".
- No fake urgency/scarcity. English with Roman Urdu where natural.
- Output clean markdown, ready to copy.`;

const MODES = {
  social_post: `You write single social media posts for DSP (AI Agents Bootcamp).
Given the brief, produce ONE post for the requested platform (default: LinkedIn) plus a
one-line alternate hook. Include hashtags only for Instagram/TikTok, not LinkedIn.${COMMON_RULES}`,

  ad_copy: `You write paid ad copy for DSP (AI Agents Bootcamp).
Given the brief, produce 3 ad variants for the requested placement (default: Meta feed):
each with headline (<40 chars), primary text (<125 chars visible), and CTA button label.
Angles must differ (e.g. career-fear reframe, proof-first, curiosity). Mark each variant's
angle.${COMMON_RULES}`,

  funnel: `You are a funnel strategist for DSP (AI Agents Bootcamp) — a WhatsApp-first
market. Given the brief, produce a funnel plan: stages (awareness → consideration →
enrollment), the content/asset for each stage, the metric to watch per stage, and where
WhatsApp DM fits as the primary conversion channel. Table or tight bullets.${COMMON_RULES}`,

  campaign: `You are a campaign planner for DSP (AI Agents Bootcamp).
Given the brief, produce a quick campaign draft: objective, audience, key message, 3
content pieces (platform + hook + format), CTA per piece, and how it maps to the weekly
cohort cycle (awareness Mon–Wed, proof Thu–Fri, enrollment push Sat–Sun before each Monday
batch).${COMMON_RULES}`,
};

module.exports = async (req, res) => {
  if (!methodGuard(req, res)) return;
  if (!requireAuth(req, res)) return;

  const { mode, brief, options } = req.body || {};
  if (!MODES[mode]) {
    res.status(400).json({ error: `"mode" must be one of: ${Object.keys(MODES).join(', ')}` });
    return;
  }
  if (!brief || !String(brief).trim()) {
    res.status(400).json({ error: '"brief" is required — describe what you want generated.' });
    return;
  }

  const userMessage = [
    `## knowledge/dsp/ (source of truth)\n\n${loadKnowledge()}`,
    `## Brief\n\n${String(brief).slice(0, 4000)}`,
    options ? `## Options\n\n${JSON.stringify(options).slice(0, 1000)}` : null,
  ].filter(Boolean).join('\n\n---\n\n');

  try {
    const message = await anthropicClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: MODES[mode],
      messages: [{ role: 'user', content: userMessage }],
    });
    const output = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    res.status(200).json({ mode, output });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
