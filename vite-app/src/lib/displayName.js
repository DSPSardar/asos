// src/lib/displayName.js
//
// WhatsApp profile names arrive as whatever the person set, and a few of them
// survive the trip as symbol soup — "$@€€[]" is a real contact in the DSP
// pipeline. Those rows are not broken data as far as the CRM is concerned; the
// phone number is intact and the conversation is real. They just cannot be
// read, and a name nobody can read is worse than no name at all, because it
// looks like the app corrupted something.
//
// So: if a name carries no letter and no digit in any script, fall back to the
// phone number. \p{L} and \p{N} are Unicode-aware, so Urdu, Arabic and Chinese
// names pass through untouched — only genuine symbol soup is replaced.

const HAS_MEANING = /[\p{L}\p{N}]/u;

export const displayName = (name, phone) => {
  const trimmed = (name || '').trim();
  if (trimmed && HAS_MEANING.test(trimmed)) return trimmed;
  return (phone || '').trim() || 'Unknown';
};

export default displayName;
