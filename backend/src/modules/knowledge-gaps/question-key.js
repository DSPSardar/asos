// src/modules/knowledge-gaps/question-key.js
//
// The Closer flags an unanswered question by writing `knowledge_gap` in its
// own words, so the same missing fact arrives as a dozen different strings:
// "fee amount", "Fee amount is not provided in the DSP knowledge base.",
// "Fee structure is not provided in the DSP knowledge base.", …
// Exact-string dedup lets every one of those become its own row, which is how
// the Settings list fills up with the same question over and over and why
// answering one of them doesn't stop the others from being asked.
//
// This module turns a raw gap string into:
//   cleanQuestion() — the readable question with the "…is not provided in the
//                     knowledge base" boilerplate stripped off (what we store)
//   questionTokens() — normalized content words (what we match on)
//   isSameQuestion() — fuzzy equality used to merge duplicates
//
// Pure functions, zero dependencies — kept out of the service so they stay
// unit-testable without a database.

// ── Boilerplate the Closer wraps around the real question ──────────────
// Everything from the first match onward is meta-commentary about the gap,
// not part of the question itself.
const GAP_CLAUSE_PATTERNS = [
  // English: "…, which is not provided in the DSP knowledge base."
  //          "…are not available in the provided information."
  //          "…is not in the DSP knowledge base."
  /[,;]?\s*(?:which\s+|that\s+)?(?:is|are|was|were)?\s*not\s+(?:provided|available|mentioned|specified|given|included|listed|found|covered|part\b|in\b)\b.*$/i,
  // Roman Urdu: "…, ye information product context mein maujood nahi."
  /[,;]\s*(?:ye|yeh)\s+.*(?:product context|knowledge base|information)\b.*$/i,
  /\s*(?:product context|knowledge base)\s+(?:mein|men|me)\s+(?:maujood|available|mention|provide[dh]?)\s+nahi\b.*$/i,
];

// A trailing location phrase that survived the clause strip above.
const TRAILING_SOURCE_PATTERNS = [
  /\s*\bin\s+the\s+(?:available\s+)?(?:dsp\s+)?(?:knowledge\s*base|product\s+context|provided\s+information|context)\b\.?$/i,
];

// "The user asked whether X" → "whether X". The prefix is narration, not question.
const NARRATION_PREFIX = /^\s*(?:the\s+)?(?:user|lead|customer|contact|student)\s+(?:has\s+)?asked\s+(?:about\s+|for\s+|if\s+)?/i;

// Words that carry no meaning for matching. Includes Roman Urdu question
// particles so "fee kitni hai" and "fee" collapse to the same key.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'of', 'for', 'to', 'in', 'on', 'at', 'by', 'from', 'with', 'about', 'regarding',
  'and', 'or', 'but', 'if', 'whether', 'that', 'which', 'this', 'these', 'those', 'it',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'has', 'have', 'had',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'they', 'them', 'their', 'he', 'she', 'his', 'her',
  'what', 'how', 'when', 'where', 'why', 'who', 'much', 'many', 'any', 'some', 'there',
  'please', 'kindly', 'ask', 'asked', 'asking', 'question', 'query',
  // Roman Urdu
  'ka', 'ki', 'ke', 'ko', 'hai', 'hain', 'ho', 'hun', 'kya', 'kia', 'koi', 'kuch',
  'mein', 'men', 'se', 'par', 'bhi', 'ye', 'yeh', 'wo', 'woh', 'aur', 'ya', 'nahi', 'nahin',
  'kitna', 'kitni', 'kitne', 'kaise', 'kahan', 'kab', 'kaun', 'karna', 'karne', 'krna',
]);

// Generic qualifiers that describe *how much* of a thing is being asked about
// rather than *which* thing. Dropping them is what makes "fee amount",
// "fee details" and "fee structure" resolve to the same question.
const GENERIC_MODIFIERS = new Set([
  'amount', 'amounts', 'detail', 'details', 'structure', 'info', 'information',
  'exact', 'total', 'full', 'complete', 'specific', 'available', 'availability',
  'provided', 'given', 'related', 'option', 'options', 'value', 'number',
]);

// ── Strip the boilerplate, keep the question ──────────────────────────
const cleanQuestion = (raw) => {
  if (!raw) return '';

  let text = String(raw).replace(/\s+/g, ' ').trim();

  for (const pattern of GAP_CLAUSE_PATTERNS) {
    const stripped = text.replace(pattern, '').trim();
    // Only accept the strip if something survives — a gap logged as nothing
    // but boilerplate is better kept whole than reduced to an empty string.
    if (stripped) text = stripped;
  }

  for (const pattern of TRAILING_SOURCE_PATTERNS) {
    const stripped = text.replace(pattern, '').trim();
    if (stripped) text = stripped;
  }

  const withoutNarration = text.replace(NARRATION_PREFIX, '').trim();
  if (withoutNarration) text = withoutNarration;

  // Drop dangling punctuation left behind by the strips.
  text = text.replace(/^[\s,;:.\-–—]+/, '').replace(/[\s,;:.\-–—]+$/, '').trim();

  return text || String(raw).trim();
};

// Crude singularization — consistency matters more than linguistic accuracy,
// since both sides of a comparison go through the same transform.
const singularize = (word) => {
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
};

// ── Normalized content words used for matching ────────────────────────
const questionTokens = (raw) => {
  const tokens = cleanQuestion(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')   // "/" and "-" become separators
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .filter((w) => w && !STOPWORDS.has(w) && !GENERIC_MODIFIERS.has(w));

  return [...new Set(tokens)];
};

// A stable string form of the token set — handy for grouping/logging.
const questionKey = (raw) => questionTokens(raw).sort().join(' ');

// ── Fuzzy equality ────────────────────────────────────────────────────
// Two gaps are the same question when their content words match exactly, or
// when they overlap heavily enough that a human would answer them once.
const SIMILARITY_THRESHOLD = 0.67;

const isSameQuestion = (a, b) => {
  const aTokens = questionTokens(a);
  const bTokens = questionTokens(b);

  // Nothing meaningful survived normalization on one side — fall back to
  // comparing the cleaned text so we still catch exact repeats.
  if (!aTokens.length || !bTokens.length) {
    return cleanQuestion(a).toLowerCase() === cleanQuestion(b).toLowerCase();
  }

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const intersection = [...aSet].filter((t) => bSet.has(t)).length;
  const union = new Set([...aSet, ...bSet]).size;

  return intersection / union >= SIMILARITY_THRESHOLD;
};

module.exports = { cleanQuestion, questionTokens, questionKey, isSameQuestion, SIMILARITY_THRESHOLD };
