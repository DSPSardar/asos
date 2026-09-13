// src/services/agent-guards/never-silent.js
//
// No inbound message may end with zero outbound. When the model returns an
// empty/blocked reply, or the thread is outside Meta's 24h customer-service
// window (free-form text is rejected with error 131047), this decides what
// goes out instead:
//   inside 24h  → a short holding line, then ONE retry with a shorter context
//   outside 24h → the tenant's approved generic re-open template
// Every occurrence is logged with ev "never-silent" by the caller.
//
// Pure: no DB, no network.

const WA_WINDOW_MS = 24 * 60 * 60 * 1000;
const EV = 'never-silent';

const HOLD_REPLY = 'Thanks — let me check that for you, one moment.';

// Fallback texts when even the retry produced nothing. Bilingual on purpose;
// no course facts (these are sent without the model seeing PRODUCT CONTEXT).
const FINAL_FALLBACK_REPLY =
  'Shukriya message ke liye! Main abhi confirm kar ke aap ko batata hun — aap ka sawal zaroor likh dein. 🙏';

const isInsideWindow = (lastInboundAt, now = new Date()) => {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return false;
  return (now.getTime() - t) < WA_WINDOW_MS;
};

const isBlankReply = (reply) => !reply || !String(reply).trim();

/**
 * Decide the outbound plan for a reply that would otherwise leave the lead
 * with nothing.
 *
 * @param {object} p
 * @param {string|null} p.reply          the reply the pipeline produced ('' / null = blocked)
 * @param {Date|string|null} p.lastInboundAt  when the lead last wrote (the message being answered)
 * @param {Date} [p.now]
 * @param {{name:string, language?:string, bodyParams?:string[]}|null} [p.reopenTemplate]
 * @returns {{ action: 'send'|'hold_and_retry'|'template'|'no_template', text?: string, template?: object, reason: string }}
 */
const planNeverSilent = ({ reply, lastInboundAt, now = new Date(), reopenTemplate = null }) => {
  const inside = isInsideWindow(lastInboundAt, now);
  const blank = isBlankReply(reply);

  if (inside && !blank) return { action: 'send', text: String(reply), reason: 'ok' };
  if (inside && blank)  return { action: 'hold_and_retry', text: HOLD_REPLY, reason: 'blank_reply' };

  // Outside the window only a template delivers, whatever the model said.
  if (reopenTemplate?.name) {
    return { action: 'template', template: reopenTemplate, reason: blank ? 'outside_24h_blank_reply' : 'outside_24h' };
  }
  return { action: 'no_template', reason: blank ? 'outside_24h_blank_reply_no_template' : 'outside_24h_no_template' };
};

// Read the tenant's approved re-open template from tenant.settings.
// Shape: settings.reopenTemplate = { name, language?: 'en', bodyParams?: ['{name}'] }
const reopenTemplateFor = (tenant) => {
  const t = tenant?.settings?.reopenTemplate;
  if (!t || typeof t !== 'object' || !t.name) return null;
  return { name: String(t.name), language: t.language || 'en', bodyParams: Array.isArray(t.bodyParams) ? t.bodyParams : ['{name}'] };
};

module.exports = { WA_WINDOW_MS, EV, HOLD_REPLY, FINAL_FALLBACK_REPLY, isInsideWindow, isBlankReply, planNeverSilent, reopenTemplateFor };
