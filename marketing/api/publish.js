// marketing/api/publish.js
// Publishes text to LinkedIn — behind the SAME two gates as the unattended daily poster
// (placeholder check + adversarial Verifier agent). The dashboard cannot skip the gates;
// a human clicking "Publish" is not allowed to publish an unsupported claim either.
//
// POST /api/publish   headers: x-trigger-secret
// body: { "text": "...", "skipVerifier": false }
//   skipVerifier is intentionally NOT implemented — kept in the comment so nobody adds it
//   casually. If the Verifier is wrong, fix knowledge/dsp/, don't bypass the gate.
// resp: { "postUrn", "verifier": {...} } or 422 with verifier violations.

const { MODEL, MAX_TOKENS } = require('../pipeline/config');
const { loadKnowledge, loadAgentPrompt, extractJson } = require('../pipeline/agentRunner');
const { publishLinkedInPost } = require('../pipeline/linkedin');
const { requireAuth, anthropicClient, methodGuard } = require('./_shared');

function placeholderProblems(text) {
  const problems = [];
  if (/TODO/i.test(text)) problems.push('contains "TODO"');
  if (/PLACEHOLDER/i.test(text)) problems.push('contains "PLACEHOLDER"');
  if (/\[[^\]]*\]/.test(text)) problems.push('contains a bracketed marker like [BOOKING LINK]');
  return problems;
}

module.exports = async (req, res) => {
  if (!methodGuard(req, res)) return;
  if (!requireAuth(req, res)) return;

  const { text } = req.body || {};
  if (!text || !String(text).trim()) {
    res.status(400).json({ error: '"text" is required.' });
    return;
  }
  if (!process.env.LINKEDIN_ACCESS_TOKEN || !process.env.LINKEDIN_AUTHOR_URN) {
    res.status(500).json({ error: 'LINKEDIN_ACCESS_TOKEN / LINKEDIN_AUTHOR_URN not configured on the server.' });
    return;
  }

  const postText = String(text).slice(0, 2900); // LinkedIn commentary limit ~3000 chars

  // Gate 1: placeholders
  const placeholderIssues = placeholderProblems(postText);
  if (placeholderIssues.length) {
    res.status(422).json({ error: 'Blocked by placeholder gate', violations: placeholderIssues.map((p) => ({ claim: '(text)', problem: p })) });
    return;
  }

  try {
    // Gate 2: Verifier agent
    const anthropic = anthropicClient();
    const todayIso = new Date().toISOString().slice(0, 10);
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: loadAgentPrompt('09-verifier.md'),
      messages: [{
        role: 'user',
        content: [
          `## Today's date\n\n${todayIso} (${weekday})`,
          `## knowledge/dsp/\n\n${loadKnowledge()}`,
          `## Content to verify\n\n${postText}`,
        ].join('\n\n---\n\n'),
      }],
    });
    const verdict = extractJson(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''));

    if (!verdict.approved) {
      res.status(422).json({ error: 'Blocked by Verifier — unsupported claims', violations: verdict.violations || [] });
      return;
    }

    const result = await publishLinkedInPost(postText);
    res.status(200).json({ postUrn: result.postUrn, verifier: verdict });
  } catch (err) {
    res.status(err.response?.status || err.status || 500).json({ error: err.response?.data?.message || err.message });
  }
};
