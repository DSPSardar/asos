// marketing/api/chat.js
// AI Marketing Chat — a DSP marketing consultant grounded in knowledge/dsp/.
//
// POST /api/chat   headers: x-trigger-secret
// body: { "messages": [{ "role": "user"|"assistant", "content": "..." }] }
// resp: { "reply": "..." }

const { MODEL, MAX_TOKENS } = require('../pipeline/config');
const { loadKnowledge } = require('../pipeline/agentRunner');
const { requireAuth, anthropicClient, methodGuard } = require('./_shared');

const SYSTEM = `You are the DSP Marketing Consultant — a senior marketing advisor for
Digital Services Program (DSP = AI Agents Bootcamp; audience: Pakistani + diaspora
learners; WhatsApp-first market).

You help the DSP team think through campaigns, content ideas, positioning, channel
strategy, and copy. You are direct, practical, and proof-first.

HARD RULES (non-negotiable):
- Every factual claim about DSP must trace to the knowledge files provided in the user
  message. Never invent students, results, counts, or events.
- Never state a price — prices are TODO placeholders; say "route pricing to DM".
- No fake urgency or fake scarcity. "~30 seats, new batch every Monday" is the real,
  stateable scarcity.
- English with Roman Urdu where natural is fine.
- Keep answers tight and actionable — bullets over essays. You're advising a busy founder.`;

module.exports = async (req, res) => {
  if (!methodGuard(req, res)) return;
  if (!requireAuth(req, res)) return;

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: '"messages" array is required.' });
    return;
  }
  // Keep the payload sane: cap history and message size.
  const history = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 8000),
  }));

  // Knowledge is injected into the FIRST user turn so the whole thread stays grounded.
  const knowledge = `## knowledge/dsp/ (source of truth — do not contradict)\n\n${loadKnowledge()}`;
  const first = history.findIndex((m) => m.role === 'user');
  if (first !== -1) history[first] = { role: 'user', content: `${knowledge}\n\n---\n\n${history[first].content}` };

  try {
    const message = await anthropicClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: history,
    });
    const reply = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    res.status(200).json({ reply });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
