// src/pages/AutomationsLive.jsx — real automation rules for signed-in tenants.
// Every toggle / save / delete hits the API; run counts and "last run" come
// from automation_runs. The engine itself runs in the worker every 10 min.
import { useCallback, useEffect, useState } from 'react';
import { automationsAPI } from '@lib/api';
import { useAuthStore } from '@stores/auth.store';
import { TRIGGER_LABEL, ACTION_LABEL, TAG_COLORS } from './AutomationsDemo';

const STAGES = ['NEW', 'QUALIFYING', 'DIAGNOSED', 'PROPOSED', 'CLOSED_WON', 'CLOSED_LOST'];
const PHASES = ['LEARN', 'BUILD', 'EARN'];
const TRIGGER_OPTIONS = [
  { value: 'no_reply',          label: 'No reply for X (we spoke last)' },
  { value: 'no_activity',       label: 'No activity for X (either side)' },
  { value: 'stage_entered',     label: 'Stage entered' },
  { value: 'dsp_phase_changed', label: 'DSP phase changed' },
];
const UNITS = ['minutes', 'hours', 'days'];

const unwrap = (r) => r?.data ?? r;
const errMsg = (e) => e?.response?.data?.message || e?.message || 'Request failed';

const relTime = (iso) => {
  if (!iso) return 'Never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? '1 day ago' : `${d} days ago`;
};

const REASON_LABEL = {
  outside_24h_window: 'Outside WhatsApp 24h window — needs an approved template',
  no_phone: 'Lead has no phone number',
  wa_send_failed: 'WhatsApp send failed',
};

export default function AutomationsLive() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'TENANT_ADMIN' || role === 'SUPERADMIN';

  const [rules, setRules]       = useState(null); // null = loading
  const [error, setError]       = useState(null);
  const [selected, setSelected] = useState(null); // rule id
  const [showNew, setShowNew]   = useState(false);
  const [busy, setBusy]         = useState({});   // id → true while a request is in flight

  const load = useCallback(() => {
    automationsAPI.list()
      .then((r) => { setRules(unwrap(r) || []); setError(null); })
      .catch((e) => { setError(errMsg(e)); setRules((x) => x ?? []); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const patchRule = (updated) => setRules((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));

  const toggle = async (rule) => {
    if (!isAdmin || busy[rule.id]) return;
    setBusy((b) => ({ ...b, [rule.id]: true }));
    patchRule({ ...rule, enabled: !rule.enabled }); // optimistic
    try {
      patchRule(unwrap(await automationsAPI.toggle(rule.id, !rule.enabled)));
    } catch (e) {
      patchRule(rule); // roll back
      setError(errMsg(e));
    } finally {
      setBusy((b) => ({ ...b, [rule.id]: false }));
    }
  };

  const remove = async (rule) => {
    if (!isAdmin) return;
    if (!window.confirm(`Delete "${rule.name}"? Its run history goes with it.`)) return;
    try {
      await automationsAPI.remove(rule.id);
      setRules((rs) => rs.filter((r) => r.id !== rule.id));
      if (selected === rule.id) setSelected(null);
    } catch (e) { setError(errMsg(e)); }
  };

  if (rules === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-500/30 border-t-indigo-400" />
      </div>
    );
  }

  const activeCount = rules.filter((r) => r.enabled).length;
  const totalSent   = rules.reduce((a, r) => a + (r.stats?.sent || 0), 0);
  const attempted   = rules.reduce((a, r) => a + (r.stats?.attempted || 0), 0);
  const successRate = attempted ? Math.round((totalSent / attempted) * 100) : null;
  const selectedRule = rules.find((r) => r.id === selected) || null;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-slate-800/60 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Automation Rules</h1>
            <p className="text-xs text-slate-400 mt-0.5">IF/THEN rules that fire automatically — evaluated every 10 minutes</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
              New Rule
            </button>
          )}
        </div>

        <div className="flex gap-6 mt-4">
          {[
            { label: 'Active rules', value: activeCount, color: 'text-emerald-400' },
            { label: 'Total rules',  value: rules.length, color: 'text-slate-200' },
            { label: 'Messages sent (all time)', value: totalSent, color: 'text-indigo-400' },
            { label: 'Delivery success', value: successRate === null ? '—' : `${successRate}%`, color: 'text-violet-400' },
          ].map((s) => (
            <div key={s.label}>
              <div className={`text-base font-bold ${s.color}`}>{s.value}</div>
              <div className="text-[11px] text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            <span>⚠️ {error}</span>
            <button onClick={() => { setError(null); load(); }} className="underline underline-offset-2 hover:text-rose-100">Retry</button>
          </div>
        )}
        {!isAdmin && (
          <div className="mt-3 text-[11px] text-slate-500">Read-only — only tenant admins can change rules.</div>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {showNew && (
            <RuleForm
              onCancel={() => setShowNew(false)}
              onSaved={(rule) => { setRules((rs) => [...rs, rule]); setShowNew(false); setSelected(rule.id); }}
            />
          )}

          {rules.length === 0 && !showNew && (
            <div className="text-center text-sm text-slate-500 py-16">No rules yet. Create one to start following up automatically.</div>
          )}

          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              isAdmin={isAdmin}
              busy={!!busy[rule.id]}
              isSelected={selected === rule.id}
              onSelect={() => setSelected(selected === rule.id ? null : rule.id)}
              onToggle={() => toggle(rule)}
            />
          ))}
        </div>

        {selectedRule && (
          <div className="w-96 border-l border-slate-800/60 overflow-y-auto flex-shrink-0">
            <RuleDetail
              key={selectedRule.id}
              rule={selectedRule}
              isAdmin={isAdmin}
              onClose={() => setSelected(null)}
              onSaved={patchRule}
              onDelete={() => remove(selectedRule)}
              onError={setError}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── RuleCard ──────────────────────────────────────────────────────────────────
function RuleCard({ rule, isAdmin, busy, isSelected, onSelect, onToggle }) {
  const trigFn = TRIGGER_LABEL[rule.trigger?.type];
  const trigLabel = trigFn ? trigFn(rule) : rule.trigger?.type;
  const s = rule.stats || {};

  return (
    <div
      className={`bg-surface/60 border rounded-xl p-4 transition-all cursor-pointer ${
        isSelected ? 'border-indigo-500/50 ring-1 ring-indigo-500/20' : 'border-slate-800/60 hover:border-slate-700/80'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          disabled={!isAdmin || busy}
          title={isAdmin ? (rule.enabled ? 'Pause rule' : 'Enable rule') : 'Admins only'}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors mt-0.5 disabled:opacity-60 disabled:cursor-not-allowed ${rule.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${rule.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-100">{rule.name}</span>
            {!rule.enabled && <span className="text-[10px] bg-slate-700/60 border border-slate-600/40 text-slate-500 px-1.5 py-0.5 rounded">Paused</span>}
          </div>

          <div className="flex items-center gap-2 text-xs mb-2 flex-wrap">
            <span className="bg-amber-500/10 border border-amber-500/25 text-amber-300 px-2 py-0.5 rounded font-mono">IF</span>
            <span className="text-slate-300">{trigLabel}</span>
            {rule.condition?.stage && rule.condition.stage !== 'any' && rule.trigger?.type !== 'stage_entered' && (
              <span className="text-slate-500">· stage {rule.condition.stage}</span>
            )}
            <span className="text-slate-600">→</span>
            <span className="bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 px-2 py-0.5 rounded font-mono">THEN</span>
            <span className="text-slate-300">{ACTION_LABEL[rule.action?.type] || rule.action?.type}</span>
            {rule.action?.waTemplate?.name && (
              <span className="text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 px-1.5 py-0.5 rounded" title="Approved Meta template used outside the 24h window">tpl: {rule.action.waTemplate.name}</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {(rule.tags || []).map((t) => (
              <span key={t} className={`text-[11px] px-2 py-0.5 rounded border font-medium ${TAG_COLORS[t] || 'bg-slate-700/50 border-slate-600/40 text-slate-400'}`}>{t}</span>
            ))}
            <span className="text-[11px] text-slate-500 ml-auto">
              {s.sent ? `${s.sent} sent` : 'Nothing sent yet'}
              {s.failed ? ` · ${s.failed} failed` : ''}
              {s.skipped ? ` · ${s.skipped} skipped` : ''}
              {' · Last: '}{relTime(s.lastRunAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── RuleDetail (edit + runs + dry-run preview) ────────────────────────────────
function RuleDetail({ rule, isAdmin, onClose, onSaved, onDelete, onError }) {
  const [template, setTemplate] = useState(rule.action?.template || '');
  const [waName, setWaName]     = useState(rule.action?.waTemplate?.name || '');
  const [saving, setSaving]     = useState(false);
  const [runs, setRuns]         = useState(null);
  const [preview, setPreview]   = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const dirty = template !== (rule.action?.template || '') || waName.trim() !== (rule.action?.waTemplate?.name || '');
  const waNameOk = waName.trim() === '' || /^[a-z0-9_]+$/.test(waName.trim());

  useEffect(() => {
    automationsAPI.runs(rule.id, 30).then((r) => setRuns(unwrap(r) || [])).catch(() => setRuns([]));
  }, [rule.id, rule.stats?.lastRunAt]);

  const save = async () => {
    setSaving(true);
    try {
      const waTemplate = waName.trim() ? { name: waName.trim(), language: 'en', bodyParams: ['{name}'] } : null;
      onSaved(unwrap(await automationsAPI.update(rule.id, { action: { type: 'send_whatsapp', template, waTemplate } })));
    } catch (e) { onError(errMsg(e)); } finally { setSaving(false); }
  };

  const dryRun = async () => {
    setPreviewing(true);
    try { setPreview(unwrap(await automationsAPI.preview(rule.id))); } catch (e) { onError(errMsg(e)); } finally { setPreviewing(false); }
  };

  const s = rule.stats || {};

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-5">
        <span className="text-sm font-semibold text-slate-100">Rule Details</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-lg leading-none">×</button>
      </div>

      <div className="text-sm font-semibold text-slate-100 mb-1">{rule.name}</div>
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium mb-4 ${rule.enabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-700/50 border-slate-600/40 text-slate-400'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${rule.enabled ? 'bg-emerald-500' : 'bg-slate-500'}`} />
        {rule.enabled ? `Active since ${relTime(rule.enabledAt)}` : 'Paused'}
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 mb-3">
        <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-1.5">Trigger (IF)</div>
        <div className="text-xs text-slate-300">{TRIGGER_LABEL[rule.trigger?.type]?.(rule) || rule.trigger?.type}</div>
        {rule.condition?.stage && rule.condition.stage !== 'any' && (
          <div className="text-[11px] text-slate-500 mt-1">Only leads in stage {rule.condition.stage}</div>
        )}
      </div>

      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 mb-4">
        <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-1.5">Action (THEN) — WhatsApp message</div>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          disabled={!isAdmin}
          rows={5}
          className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500/60 disabled:opacity-70"
        />
        <div className="text-[11px] text-slate-500 italic mt-1.5">{'{name}'} → lead's first name · sent as free text when the lead messaged you in the last 24h</div>

        <div className="mt-3">
          <label className="text-[11px] font-bold text-indigo-400/80 uppercase tracking-wider block mb-1">Meta template (outside 24h window)</label>
          <input
            value={waName}
            onChange={(e) => setWaName(e.target.value)}
            disabled={!isAdmin}
            placeholder="e.g. dsp_no_reply_followup"
            className={`w-full bg-slate-800/60 border rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono placeholder-slate-600 focus:outline-none disabled:opacity-70 ${waNameOk ? 'border-slate-700/60 focus:border-indigo-500/60' : 'border-rose-500/60'}`}
          />
          <div className="text-[11px] text-slate-500 italic mt-1">
            {waName.trim()
              ? <>Approved template name from WhatsApp Manager. {'{{1}}'} = first name. Leads outside the 24h window get this instead of being skipped.</>
              : <>Empty → leads outside the 24h window are skipped (logged as <span className="font-mono">outside_24h_window</span>).</>}
          </div>
        </div>

        <div className="flex items-center justify-end mt-2">
          {isAdmin && dirty && (
            <button onClick={save} disabled={saving || template.trim().length < 5 || !waNameOk} className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-semibold rounded-md">
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Sent', value: s.sent || 0 },
          { label: 'Failed', value: s.failed || 0 },
          { label: 'Skipped', value: s.skipped || 0 },
        ].map((k) => (
          <div key={k.label} className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-2.5">
            <div className="text-sm font-bold text-slate-100">{k.value}</div>
            <div className="text-[11px] text-slate-500">{k.label}</div>
          </div>
        ))}
      </div>

      {isAdmin && (
        <div className="mb-4">
          <button onClick={dryRun} disabled={previewing} className="w-full px-3 py-1.5 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/60 text-slate-200 text-xs font-medium rounded-lg disabled:opacity-50">
            {previewing ? 'Checking…' : 'Dry run — who would get this right now?'}
          </button>
          {preview && (
            <div className="mt-2 bg-slate-800/40 border border-slate-700/40 rounded-lg p-3 text-xs">
              <div className="text-slate-200 font-semibold mb-1">{preview.wouldSend} lead{preview.wouldSend === 1 ? '' : 's'} match over the last 14 days</div>
              {preview.sample?.length ? (
                <ul className="space-y-0.5 text-slate-400">
                  {preview.sample.map((m) => (
                    <li key={m.leadId} className="flex justify-between gap-2">
                      <span className="truncate">{m.name || m.phone} · {m.stage}</span>
                      <span className={m.insideWindow ? 'text-emerald-400' : 'text-amber-400'}>{m.insideWindow ? 'would send' : 'outside 24h'}</span>
                    </li>
                  ))}
                </ul>
              ) : <div className="text-slate-500">Nobody right now.</div>}
              <div className="text-[11px] text-slate-500 italic mt-2">Nothing was sent. Enabling the rule only fires for events from that moment on.</div>
            </div>
          )}
        </div>
      )}

      <div className="mb-4">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Recent runs</div>
        {runs === null ? (
          <div className="text-xs text-slate-500">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="text-xs text-slate-500">No runs yet.</div>
        ) : (
          <ul className="space-y-1.5">
            {runs.map((r) => (
              <li key={r.id} className="text-xs flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-slate-200 truncate">{r.lead?.contact?.name || r.lead?.contact?.phone || r.leadId}</div>
                  <div className="text-[11px] text-slate-500">{relTime(r.createdAt)}{r.reason ? ` · ${REASON_LABEL[r.reason] || (r.reason.startsWith('template:') ? `via template ${r.reason.slice(9)}` : r.reason)}` : ''}</div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${
                  r.status === 'SENT' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : r.status === 'FAILED' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isAdmin && (
        <button onClick={onDelete} className="text-[11px] text-rose-400/80 hover:text-rose-300 underline underline-offset-2">Delete rule</button>
      )}
    </div>
  );
}

// ── RuleForm (create) ─────────────────────────────────────────────────────────
function RuleForm({ onCancel, onSaved }) {
  const [name, setName]       = useState('');
  const [type, setType]       = useState('no_reply');
  const [delay, setDelay]     = useState(24);
  const [unit, setUnit]       = useState('hours');
  const [stage, setStage]     = useState('PROPOSED');
  const [phase, setPhase]     = useState('BUILD');
  const [cond, setCond]       = useState('any');
  const [template, setTemplate] = useState('');
  const [tags, setTags]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);

  const submit = async () => {
    setSaving(true); setErr(null);
    const trigger = { type, delay: Number(delay) || 0, unit };
    if (type === 'stage_entered') trigger.stage = stage;
    if (type === 'dsp_phase_changed') trigger.phase = phase;
    try {
      const r = await automationsAPI.create({
        name, trigger,
        condition: { stage: type === 'stage_entered' ? stage : cond },
        action: { type: 'send_whatsapp', template },
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6),
      });
      onSaved(unwrap(r));
    } catch (e) {
      const fields = e?.response?.data?.errors;
      setErr(fields ? Object.entries(fields).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join(' · ') : errMsg(e));
    } finally { setSaving(false); }
  };

  const inp = 'w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60';

  return (
    <div className="bg-surface/60 border-2 border-dashed border-indigo-500/30 rounded-xl p-5">
      <div className="text-sm font-semibold text-slate-200 mb-4">New Automation Rule</div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Rule name</label>
          <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2nd follow-up after 48h" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Trigger (IF)</label>
            <select className={inp} value={type} onChange={(e) => setType(e.target.value)}>
              {TRIGGER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{type === 'stage_entered' || type === 'dsp_phase_changed' ? 'Wait after event' : 'Quiet for'}</label>
            <div className="flex gap-2">
              <input type="number" min={0} className={inp} value={delay} onChange={(e) => setDelay(e.target.value)} />
              <select className={inp} value={unit} onChange={(e) => setUnit(e.target.value)}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {type === 'stage_entered' && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Stage</label>
              <select className={inp} value={stage} onChange={(e) => setStage(e.target.value)}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          {type === 'dsp_phase_changed' && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">DSP phase</label>
              <select className={inp} value={phase} onChange={(e) => setPhase(e.target.value)}>
                {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
          {(type === 'no_reply' || type === 'no_activity') && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Only leads in stage</label>
              <select className={inp} value={cond} onChange={(e) => setCond(e.target.value)}>
                <option value="any">Any stage</option>
                {STAGES.filter((s) => s !== 'CLOSED_LOST').map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">WhatsApp message (THEN) — use {'{name}'} for the lead's first name</label>
          <textarea rows={4} className={inp} value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="Salam {name}! …" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Tags (comma separated, optional)</label>
          <input className={inp} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="follow-up, whatsapp" />
        </div>
        {err && <div className="text-xs text-rose-300">⚠️ {err}</div>}
        <div className="flex items-center gap-2 pt-1">
          <button onClick={submit} disabled={saving || name.trim().length < 2 || template.trim().length < 5} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-all">
            {saving ? 'Saving…' : 'Save rule (paused)'}
          </button>
          <button onClick={onCancel} className="px-3 py-1.5 bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-all">Cancel</button>
          <span className="text-[11px] text-slate-500 ml-auto">New rules start paused — enable when you're ready</span>
        </div>
      </div>
    </div>
  );
}
