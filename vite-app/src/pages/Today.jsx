// src/pages/Today.jsx — Today's Queue: the morning approval inbox.
//
// One page that says what needs a human today, grouped by urgency, sorted
// by value, with a pre-drafted reply per row. Open → skim → edit → send.
//
// Rules this page holds itself to:
//   - NOTHING sends without a click. Every draft is editable first.
//   - A draft costs AI tokens, so it is generated only when a row is expanded
//     (or "Draft reply" is pressed) and the API caches it until the thread
//     moves. Collapsed rows cost nothing.
//   - Outside Meta's 24h window free text cannot deliver (error 131047): the
//     row says so and offers the approved-template path instead of a Send
//     button that would fail.
//   - Selection (who is listed, in what order) is the backend's
//     needsYou.select.js — the same code the 09:00 digest uses.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { todayAPI } from '@lib/api';
import { displayName } from '@lib/displayName';

const unwrap = (r) => r?.data ?? r;
const errMsg = (e) => e?.response?.data?.message || e?.message || 'Request failed';

const GROUPS = {
  needs_me:   { title: 'Needs you personally', blurb: 'Payment proofs to verify, enrolled students waiting, threads a human took over.', tone: 'rose' },
  unanswered: { title: 'Unanswered', blurb: 'They wrote last and nobody replied — the AI should have.', tone: 'amber' },
  quiet:      { title: 'Gone quiet', blurb: 'We spoke last, 48h+ of silence. Hot and warm leads only.', tone: 'sky' },
  stalled:    { title: 'Stalled', blurb: 'Sitting in a stage too long.', tone: 'violet' },
};
const TONE = {
  rose:   'border-rose-500/30 text-rose-300 bg-rose-500/10',
  amber:  'border-amber-500/30 text-amber-300 bg-amber-500/10',
  sky:    'border-sky-500/30 text-sky-300 bg-sky-500/10',
  violet: 'border-violet-500/30 text-violet-300 bg-violet-500/10',
};
const SCORE_TONE = { HOT: 'text-rose-300 bg-rose-500/10 border-rose-500/30', WARM: 'text-amber-300 bg-amber-500/10 border-amber-500/30', COLD: 'text-slate-400 bg-slate-700/40 border-slate-600/40' };
const REASON = {
  payment_proof: '💳 Payment proof to verify',
  student_message: '🎓 Enrolled student wrote — nobody replied',
  handoff: 'Handed to a human — their message is waiting',
  ai_off: 'AI is off — their message is waiting',
  no_reply_from_ai: 'AI did not answer',
  we_spoke_last: 'We spoke last',
};

const waiting = (h) => {
  if (h == null) return '';
  if (h < 1) return '<1h';
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};
const clock = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const stageLabel = (s) => String(s || '').replace('_', ' ');

export default function Today() {
  const [queue, setQueue] = useState(null);     // null = loading
  const [error, setError] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [openId, setOpenId] = useState(null);   // expanded conversation id
  const [toast, setToast] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (opts = {}) => {
    setRefreshing(true);
    try {
      const [q, t] = await Promise.all([todayAPI.queue(opts.all || showAll), todayAPI.templates().catch(() => ({ data: [] }))]);
      setQueue(unwrap(q));
      setTemplates(unwrap(t) || []);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
      setQueue((x) => x ?? { rows: [], counts: {}, total: 0, hidden: 0, context: {} });
    } finally { setRefreshing(false); }
  }, [showAll]);
  useEffect(() => { load(); }, [load]);

  const flash = (msg, kind = 'ok') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3500); };

  const removeRow = (conversationId) => setQueue((q) => {
    if (!q) return q;
    const rows = q.rows.filter((r) => r.conversationId !== conversationId);
    const counts = {};
    for (const g of Object.keys(GROUPS)) counts[g] = rows.filter((r) => r.group === g).length;
    return { ...q, rows, counts, total: rows.length };
  });

  const grouped = useMemo(() => {
    const out = {};
    for (const g of Object.keys(GROUPS)) out[g] = [];
    for (const r of queue?.rows || []) (out[r.group] || (out[r.group] = [])).push(r);
    return out;
  }, [queue]);

  if (queue === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
      </div>
    );
  }

  const day = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const ctx = queue.context || {};

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-24">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">Today</h1>
            <div className="text-xs text-slate-500 mt-0.5">{day} · sorted by value, not by time</div>
          </div>
          <button onClick={() => load()} disabled={refreshing} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700/60 bg-surface/60 text-slate-300 hover:text-slate-100 hover:border-slate-600 disabled:opacity-50">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            Couldn't load the queue: {error}
          </div>
        )}

        {/* Count chips */}
        <div className="flex gap-2 flex-wrap mb-5">
          {Object.entries(GROUPS).map(([g, meta]) => (
            <a key={g} href={`#group-${g}`} className={`px-2.5 py-1 rounded-full border text-xs font-medium ${queue.counts?.[g] ? TONE[meta.tone] : 'border-slate-800 text-slate-600 bg-transparent'}`}>
              {meta.title} <span className="font-bold">{queue.counts?.[g] || 0}</span>
              {(queue.totals?.[g] || 0) > (queue.counts?.[g] || 0) ? <span className="opacity-70"> of {queue.totals[g]}</span> : null}
            </a>
          ))}
          {queue.hidden > 0 && (
            <button onClick={() => { setShowAll(true); load({ all: true }); }} className="px-2.5 py-1 rounded-full border border-slate-800 text-xs text-slate-500 hover:text-slate-300">
              {queue.hidden} skipped today · show
            </button>
          )}
        </div>

        {queue.total === 0 ? (
          <EmptyState ctx={ctx} />
        ) : (
          Object.entries(GROUPS).map(([g, meta]) => grouped[g]?.length ? (
            <section key={g} id={`group-${g}`} className="mb-6 scroll-mt-4">
              <div className="sticky top-0 z-10 -mx-3 sm:mx-0 px-3 sm:px-0 py-2 bg-bg/95 backdrop-blur">
                <div className="flex items-baseline gap-2">
                  <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold uppercase tracking-wider ${TONE[meta.tone]}`}>{meta.title}</span>
                  <span className="text-xs text-slate-500">{grouped[g].length}{(queue.totals?.[g] || 0) > grouped[g].length ? ` of ${queue.totals[g]}` : ''}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {meta.blurb}
                  {(queue.totals?.[g] || 0) > grouped[g].length ? ` Top ${grouped[g].length} by value shown — the other ${queue.totals[g] - grouped[g].length} are the re-engagement list, not this morning's work.` : ''}
                </div>
              </div>
              <div className="space-y-2 mt-2">
                {grouped[g].map((row) => (
                  <QueueRow
                    key={row.conversationId || row.leadId}
                    row={row}
                    open={openId === row.conversationId}
                    onToggle={() => setOpenId((id) => (id === row.conversationId ? null : row.conversationId))}
                    templates={templates}
                    onSent={(what) => { removeRow(row.conversationId); flash(`Sent to ${displayName(row.name, row.phone)} — ${what}`); }}
                    onSkipped={(msg) => { removeRow(row.conversationId); flash(msg || 'Hidden until tomorrow', 'muted'); }}
                    onError={(m) => flash(m, 'err')}
                  />
                ))}
              </div>
            </section>
          ) : null)
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-xs font-medium shadow-xl border ${
          toast.kind === 'err' ? 'bg-rose-950 border-rose-500/40 text-rose-100' : toast.kind === 'muted' ? 'bg-slate-900 border-slate-700 text-slate-300' : 'bg-emerald-950 border-emerald-500/40 text-emerald-100'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function EmptyState({ ctx }) {
  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 px-6 py-10 text-center">
      <div className="text-3xl mb-2">☀️</div>
      <div className="text-lg font-semibold text-emerald-200">Nothing needs you today.</div>
      <div className="text-xs text-slate-400 mt-2">
        {ctx.handledByAi ? `The AI is handling ${ctx.handledByAi} conversation${ctx.handledByAi === 1 ? '' : 's'}` : 'No open conversations right now'}
        {ctx.inSequences ? ` · ${ctx.inSequences} lead${ctx.inSequences === 1 ? '' : 's'} in follow-up sequences` : ''}.
      </div>
      <div className="text-[11px] text-slate-500 mt-4">Nobody is waiting on a reply, no payment proofs are pending, and no hot lead has gone quiet or stalled.</div>
    </div>
  );
}

// ── One row ──────────────────────────────────────────────────────────
function QueueRow({ row, open, onToggle, templates, onSent, onSkipped, onError }) {
  const name = displayName(row.name, row.phone);
  const [context, setContext] = useState(null);
  const [draft, setDraft] = useState('');
  const [draftState, setDraftState] = useState('idle'); // idle | loading | ready | error
  const [draftMeta, setDraftMeta] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryState, setSummaryState] = useState('idle');
  const [sending, setSending] = useState(false);
  const [tplName, setTplName] = useState('');
  const loadedFor = useRef(null);
  const canDraft = !!row.conversationId;

  // Expanding costs one context read and (in-window rows only) one cached
  // draft — never in bulk, never for collapsed rows.
  useEffect(() => {
    if (!open || !canDraft || loadedFor.current === row.conversationId) return;
    loadedFor.current = row.conversationId;
    todayAPI.context(row.conversationId).then((r) => setContext(unwrap(r))).catch(() => setContext({ messages: [] }));
    if (row.insideWindow && row.reason !== 'payment_proof') fetchDraft(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchDraft = async (force) => {
    setDraftState('loading');
    try {
      const d = unwrap(await todayAPI.draft(row.conversationId, force));
      setDraft(d.draft || '');
      setDraftMeta(d);
      setDraftState('ready');
    } catch (e) { setDraftState('error'); onError(`Draft failed: ${errMsg(e)}`); }
  };

  const fetchSummary = async () => {
    setSummaryState('loading');
    try { setSummary(unwrap(await todayAPI.summary(row.conversationId)).summary); setSummaryState('ready'); } catch (e) { setSummaryState('error'); onError(`Summary failed: ${errMsg(e)}`); }
  };

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try { await todayAPI.send(row.conversationId, draft.trim()); onSent('reply'); } catch (e) { onError(errMsg(e)); } finally { setSending(false); }
  };
  const sendTpl = async () => {
    if (!tplName || sending) return;
    if (!window.confirm(`Send the approved template "${tplName}" to ${name}?`)) return;
    setSending(true);
    try { await todayAPI.sendTemplate(row.conversationId, tplName); onSent(`template ${tplName}`); } catch (e) { onError(errMsg(e)); } finally { setSending(false); }
  };
  const skip = async () => {
    try { await todayAPI.skip(row.conversationId); onSkipped('Hidden until tomorrow'); } catch (e) { onError(errMsg(e)); }
  };
  const dismiss = async () => {
    try { await todayAPI.dismiss(row.conversationId); onSkipped('Dismissed — comes back if they write again'); } catch (e) { onError(errMsg(e)); }
  };
  const SkipButtons = () => (
    <>
      <button onClick={skip} title="Hide until tomorrow" className="px-3 py-2 rounded-lg border border-slate-700/60 text-slate-300 text-xs hover:text-slate-100">Skip today</button>
      <button onClick={dismiss} title="Hide until they write again" className="px-3 py-2 rounded-lg border border-slate-800 text-slate-500 text-xs hover:text-rose-300 hover:border-rose-500/40">Dismiss</button>
    </>
  );

  const threadHref = row.conversationId ? `/conversations?id=${row.conversationId}` : '/leads';
  const waHref = row.phone ? `https://wa.me/${String(row.phone).replace(/\D/g, '')}` : null;
  const isProof = row.reason === 'payment_proof';
  const canFreeText = row.insideWindow && !isProof;

  return (
    <div className={`rounded-xl border bg-surface/60 transition-colors ${open ? 'border-indigo-500/40' : 'border-slate-800/60 hover:border-slate-700/80'}`}>
      {/* Collapsed line — tap anywhere to expand */}
      <button onClick={onToggle} className="w-full text-left px-3 sm:px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-100 truncate max-w-[60vw] sm:max-w-none">{name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${SCORE_TONE[row.scoreLabel] || SCORE_TONE.COLD}`}>{row.scoreLabel} {row.aiScore}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700/60 text-slate-400">{stageLabel(row.stage)}</span>
              {row.sequence && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-sky-500/30 text-sky-300 bg-sky-500/10" title={row.sequence.ruleName}>
                  auto touch {row.sequence.step}/{row.sequence.total}{row.sequence.nextDueAt ? ` · next ${clock(row.sequence.nextDueAt)}` : ''}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-1 line-clamp-2 sm:truncate">
              <span className={isProof ? 'text-rose-300 font-medium' : 'text-slate-500'}>{REASON[row.reason] || row.reason}</span>
              {row.summary ? <span className="text-slate-600"> · </span> : null}
              {row.summary ? <span className="text-slate-300">"{row.summary}"</span> : null}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-bold text-slate-200 tabular-nums">{waiting(row.hoursWaiting)}</div>
            <div className="text-[10px] text-slate-500">waiting</div>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-800/60 px-3 sm:px-4 py-3 space-y-3">
          {/* Contact + quick links */}
          <div className="flex items-center gap-3 flex-wrap text-xs">
            {row.phone && <span className="font-mono text-slate-300">+{String(row.phone).replace(/^\+/, '')}</span>}
            {waHref && <a href={waHref} target="_blank" rel="noreferrer" className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2">Open in WhatsApp</a>}
            <Link to={threadHref} className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2">Open thread</Link>
            {row.daysInStage != null && <span className="text-slate-500">{row.daysInStage} days in {stageLabel(row.stage)}</span>}
            {row.problem && <span className="text-slate-500 basis-full">Context: {row.problem}</span>}
            {row.lastInboundAt && <span className="text-slate-500">they last wrote {clock(row.lastInboundAt)}</span>}
          </div>

          {/* Last few messages */}
          {context === null ? (
            <div className="text-xs text-slate-500">Loading thread…</div>
          ) : (
            <div className="space-y-1">
              {(context.messages || []).map((m) => (
                <div key={m.id} className={`text-xs px-2.5 py-1.5 rounded-lg max-w-[92%] ${m.direction === 'INBOUND' ? 'bg-slate-800/70 text-slate-200' : 'bg-indigo-500/10 text-indigo-100 ml-auto'}`}>
                  <span className="text-[10px] text-slate-500 mr-1.5">{m.direction === 'INBOUND' ? 'Them' : (m.sender === 'AGENT' ? 'You' : m.sender === 'SYSTEM' ? 'Auto' : 'AI')}</span>
                  {m.content || `[${String(m.type || '').toLowerCase()}]`}
                  {m.status === 'FAILED' && <span className="ml-1 text-[10px] text-rose-300">not delivered</span>}
                </div>
              ))}
              {!context.messages?.length && <div className="text-xs text-slate-500">No messages yet.</div>}
            </div>
          )}

          {/* AI summary — optional, on demand, cached */}
          <div className="text-xs">
            {summaryState === 'ready' ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-slate-300 whitespace-pre-line">{summary}</div>
            ) : (
              <button onClick={fetchSummary} disabled={summaryState === 'loading' || !canDraft} className="text-slate-400 hover:text-slate-200 underline underline-offset-2 disabled:opacity-50">
                {summaryState === 'loading' ? 'Summarising…' : 'AI summary of the whole thread'}
              </button>
            )}
          </div>

          {/* Action area */}
          {isProof ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-100">
              A payment screenshot is waiting. Open the thread to check it and press <b>Confirm payment</b> there — that is the only path that marks a lead Won.
              <div className="mt-2 flex items-center gap-2 flex-wrap"><Link to={threadHref} className="inline-block px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold">Open thread to verify</Link><SkipButtons /></div>
            </div>
          ) : canFreeText ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider">Draft reply {draftMeta?.cached ? <span className="text-slate-500 font-normal normal-case">(cached)</span> : null}</label>
                <button onClick={() => fetchDraft(true)} disabled={draftState === 'loading'} className="text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2 disabled:opacity-50">
                  {draftState === 'loading' ? 'Drafting…' : draftState === 'ready' ? 'Redraft' : 'Draft reply'}
                </button>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                placeholder={draftState === 'loading' ? 'Writing a draft from the thread…' : 'Type a reply, or press Draft reply'}
                className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/60"
              />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={send} disabled={sending || !draft.trim()} className="flex-1 sm:flex-none px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold">
                  {sending ? 'Sending…' : 'Send'}
                </button>
                <SkipButtons />
              </div>
              <div className="text-[10px] text-slate-500 mt-1.5">Free text delivers — they wrote to us in the last 24h. Nothing sends until you press Send.</div>
            </div>
          ) : (
            <div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <b>Outside Meta's 24h window</b> — free text will not deliver (error 131047). Only an approved template reaches them; if they reply, the window reopens.
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <select value={tplName} onChange={(e) => setTplName(e.target.value)} className="flex-1 min-w-[12rem] bg-slate-900/60 border border-slate-700/60 rounded-lg px-2 py-2 text-xs text-slate-100 focus:outline-none">
                  <option value="">Choose an approved template…</option>
                  {templates.map((t) => <option key={t.name} value={t.name}>{t.name} — {t.source}</option>)}
                </select>
                <button onClick={sendTpl} disabled={sending || !tplName} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold">
                  {sending ? 'Sending…' : 'Send template'}
                </button>
                <SkipButtons />
              </div>
              {tplName && <div className="text-[11px] text-slate-400 mt-2 whitespace-pre-line">{templates.find((t) => t.name === tplName)?.text}</div>}
              {!templates.length && <div className="text-[11px] text-slate-500 mt-2">No approved templates found. Add one to an automation rule (Automations → rule → Meta template) and it appears here.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
