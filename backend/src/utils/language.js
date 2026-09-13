// src/utils/language.js
//
// Detect the lead's language from their first message so the Closer replies
// in it from turn one. Script-based for Urdu / Arabic / Hindi (Devanagari);
// keyword-based for Roman Urdu vs English. Default: Urdu + English mix.
//
// Pure — no model call, no DB.

const LANGUAGES = {
  ur:       'Urdu (Urdu script)',
  roman_ur: 'Roman Urdu (Urdu written in Latin letters)',
  en:       'English',
  ar:       'Arabic',
  hi:       'Hindi (Devanagari script)',
  mixed:    'Urdu + English mix',
};

// Common Roman-Urdu tokens that essentially never appear in English prose.
// Tokens that are also English words (fee, course, sir, to, or, main…) are
// deliberately left out — they made plain English read as Roman Urdu.
const ROMAN_URDU_WORDS = /\b(kya|kia|hai|hain|hy|nahi|nahin|nai|mujhe|mujhy|mera|meri|mere|aap|apka|apki|kaise|kese|kaisay|kitna|kitni|kitne|karna|karni|karein|karo|kr|hun|hoon|mein|bhai|acha|theek|thik|shukriya|salam|assalam|walaikum|batao|bataye|batayein|chahiye|chahiy|paisay|paise|raha|rahi|rahe|hoga|hogi|liye|lye|wala|wali|yeh|woh|kab|kahan|kyun|kyu|abhi|bhi|tou|aur|kuch|koi|dena|dijiye|dijiyega|lena|lijiye|samajh|zaroor|bilkul|matlab|magar|lekin|phir|kaunsa|kaun|konsa|hamara|hamari|tumhara|unka|inka|ki|ka|ke|ko|se|ye|wo|kar|karain)\b/gi;
// Arabic-script letters that are Urdu-specific (ٹ ڈ ڑ ں ھ ے ی) vs plain Arabic.
const URDU_ONLY_CHARS = /[ٹڈڑںھےۓی]/;
const ARABIC_SCRIPT = /[؀-ۿ]/;
const DEVANAGARI = /[ऀ-ॿ]/;

const detectLanguage = (text) => {
  const t = String(text || '').trim();
  if (!t) return 'mixed';
  if (DEVANAGARI.test(t)) return 'hi';
  if (ARABIC_SCRIPT.test(t)) return URDU_ONLY_CHARS.test(t) ? 'ur' : 'ar';

  const words = t.match(/[a-zA-Z']+/g) || [];
  if (words.length === 0) return 'mixed';
  const romanHits = (t.match(ROMAN_URDU_WORDS) || []).length;
  const ratio = romanHits / words.length;
  // Short greetings ("salam", "hi") are too little signal — keep the default mix.
  if (words.length <= 2) return 'mixed';
  if (ratio >= 0.4) return 'roman_ur';
  if (ratio === 0) return 'en';
  return 'mixed';
};

const languageInstruction = (code) => {
  const label = LANGUAGES[code] || LANGUAGES.mixed;
  if (code === 'mixed' || !LANGUAGES[code]) {
    return 'LEAD LANGUAGE: not yet clear — reply in an Urdu + English mix (Roman Urdu with English terms), and switch to whatever language the lead uses next.';
  }
  return `LEAD LANGUAGE: ${label}. Reply in ${label}. If the lead switches language, follow them.`;
};

module.exports = { LANGUAGES, detectLanguage, languageInstruction };
