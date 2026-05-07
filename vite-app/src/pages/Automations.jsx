// src/pages/Automations.jsx — Automation Rule Builder UI (visual-only, no execution)
import { useState } from 'react';

// ── Default rule set ──────────────────────────────────────────────────────────
const DEFAULT_RULES = [
  {
    id: 'r1',
    name: 'No-Reply Follow-up',
    enabled: true,
    trigger: { type: 'no_reply', delay: 24, unit: 'hours' },
    condition: { stage: 'any' },
    action: { type: 'send_whatsapp', template: 'follow_up_1' },
    lastRun: '2 hours ago',
    executions: 87,
    successRate: 94,
    tags: ['follow-up', 'whatsapp'],
  },
  {
    id: 'r2',
    name: 'Unpaid Enrollment Reminder',
    enabled: true,
    trigger: { type: 'stage_entered', stage: 'PROPOSED', delay: 48, unit: 'hours' },
    condition: { stage: 'PROPOSED' },
    action: { type: 'send_whatsapp', template: 'payment_reminder' },
    lastRun: '5 hours ago',
    executions: 23,
    successRate: 78,
    tags: ['payment', 'whatsapp'],
  },
  {
    id: 'r3',
    name: 'Enrollment Welcome Sequence',
    enabled: true,
    trigger: { type: 'stage_entered', stage: 'CLOSED_WON', delay: 0, unit: 'minutes' },
    condition: { stage: 'CLOSED_WON' },
    action: { type: 'send_whatsapp', template: 'welcome_onboarding' },
    lastRun: '1 day ago',
    executions: 40,
    successRate: 100,
    tags: ['welcome', 'onboarding'],
  },
  {
    id: 'r4',
    name: 'Cold Lead Re-engage (7d)',
    enabled: false,
    trigger: { type: 'no_activity', delay: 7, unit: 'days' },
    condition: { stage: 'QUALIFYING' },
    action: { type: 'send_whatsapp', template: 're_engage' },
    lastRun: 'Never',
    executions: 0,
    successRate: 0,
    tags: ['re-engagement', 'cold'],
  },
  {
    id: 'r5',
    name: 'Certificate Issued Notification',
    enabled: true,
    trigger: { type: 'dsp_phase_changed', phase: 'BUILD', delay: 0, unit: 'minutes' },
    condition: { dspPhase: 'BUILD' },
    action: { type: 'send_whatsapp', template: 'certificate_issued' },
    lastRun: '3 days ago',
    executions: 16,
    successRate: 100,
    tags: ['certificate', 'milestone'],
  },
  {
    id: 'r6',
    name: 'Earning Milestone Congratulations',
    enabled: true,
    trigger: { type: 'dsp_phase_changed', phase: 'EARN', delay: 0, unit: 'minutes' },
    condition: { dspPhase: 'EARN' },
    action: { type: 'send_whatsapp', template: 'earning_congrats' },
    lastRun: '1 week ago',
    executions: 6,
    successRate: 100,
    tags: ['earn', 'milestone'],
  },
];

// ── Template library ──────────────────────────────────────────────────────────
const TEMPLATES = {
  follow_up_1:        { label: 'Follow-up #1', preview: 'Assalamualaikum {name} bhai! Aap ke sath share karna chahta tha ke DSP ka next batch starting soon hai. Kya aap ka AI course ke baare mein koi sawaal hai? 😊' },
  payment_reminder:   { label: 'Payment Reminder', preview: 'Salam {name}! Aap ne enrollment complete ki — great decision! Payment confirm karne ke liye please is link pe click karein: {payment_link}. Koi mushkil ho to batayen.' },
  welcome_onboarding: { label: 'Welcome & Onboarding', preview: '🎉 Mubarak ho {name}! Aap DSP Agentic AI Mastery family mein shamil ho gaye! WhatsApp group invite aap ko abhi milega. Pehla session kal subha 9 baje hai.' },
  re_engage:          { label: 'Re-engage (cold)', preview: 'Salam {name}! Aap ne AI course mein interest dikhaya tha. Humara next batch mein sirf kuch seats bachi hain. Kya aap ab bhi interested hain?' },
  certificate_issued: { label: 'Certificate Notification', preview: '🏆 {name}, aap ka DSP + SECP Certified AI Mastery certificate issue ho gaya! LinkedIn pe add karein aur clients tak apni skills pahunchayen. Link: {cert_link}' },
  earning_congrats:   { label: 'Earning Congrats', preview: '💰 Incredible, {name}! Aap Earn phase mein enter ho gaye. Aap ab AI services sell karne ke ready hain. Team aap ke pehle client mein madad ke liye available hai!' },
};

// ── Trigger labels ────────────────────────────────────────────────────────────
const TRIGGER_LABEL = {
  no_reply:           (r) => `No reply for ${r.trigger.delay} ${r.trigger.unit}`,
  stage_entered:      (r) => `Stage changed → ${r.trigger.stage}`,
  no_activity:        (r) => `No activity for ${r.trigger.delay} ${r.trigger.unit}`,
  dsp_phase_changed:  (r) => `DSP Phase → ${r.trigger.phase}`,
};

const ACTION_LABEL = {
  send_whatsapp: 'Send WhatsApp message',
  send_email:    'Send Email',
  tag_lead:      'Tag lead',
  assign_agent:  'Assign to agent',
};

// ── Colors ────────────────────────────────────────────────────────────────────
const TAG_COLORS = {
  'follow-up':    'bg-indigo-500/10 border-indigo-500/30 text-indigo-400',
  'whatsapp':     'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  'payment':      'bg-amber-500/10  border-amber-500/30  text-amber-400',
  'welcome':      'bg-violet-500/10 border-violet-500/30 text-violet-400',
  'onboarding':   'bg-violet-500/10 border-violet-500/30 text-violet-400',
  'cold':         'bg-slate-700/60  border-slate-600/40  text-slate-400',
  're-engagement':'bg-rose-500/10   border-rose-500/30   text-rose-400',
  'certificate':  'bg-amber-500/10  border-amber-500/30  text-amber-400',
  'milestone':    'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  'earn':         'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
};

export default function Automations() {
  const [rules, setRules]         = useState(DEFAULT_RULES);
  const [selected, setSelected]   = useState(null);
  const [showNew, setShowNew]      = useState(false);
  const [previewTpl, setPreviewTpl]= useState(null);

  const toggle = (id) => setRules(rs => rs.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));

  const activeCount   = rules.filter(r => r.enabled).length;
  const totalExec     = rules.reduce((a,r) => a + r.executions, 0);
  const avgSuccess    = rules.filter(r=>r.executions>0).reduce((a,r,_,arr) => a + r.successRate/arr.length, 0);

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-slate-800/60 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Automation Rules</h1>
            <p className="text-xs text-slate-400 mt-0.5">IF/THEN rules that fire automatically — no manual follow-up needed</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
            New Rule
          </button>
        </div>

        {/* Stats strip */}
        <div className="flex gap-6 mt-4">
          {[
            { label: 'Active rules', value: activeCount, color: 'text-emerald-400' },
            { label: 'Total rules',  value: rules.length, color: 'text-slate-200' },
            { label: 'Executions (all time)', value: totalExec, color: 'text-indigo-400' },
            { label: 'Avg success rate', value: `${avgSuccess.toFixed(0)}%`, color: 'text-violet-400' },
          ].map(s => (
            <div key={s.label}>
              <div className={`text-base font-bold ${s.color}`}>{s.value}</div>
              <div className="text-[11px] text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Rules list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {rules.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              isSelected={selected?.id === rule.id}
              onSelect={() => setSelected(selected?.id === rule.id ? null : rule)}
              onToggle={() => toggle(rule.id)}
              onPreview={() => setPreviewTpl(rule.action.template)}
            />
          ))}

          {/* Empty new rule placeholder */}
          {showNew && (
            <NewRuleCard onCancel={() => setShowNew(false)} />
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 border-l border-slate-800/60 overflow-y-auto flex-shrink-0">
            <RuleDetail rule={selected} onClose={() => setSelected(null)} onPreview={(tpl) => setPreviewTpl(tpl)} />
          </div>
        )}
      </div>

      {/* ── Template preview modal ────────────────────────────────── */}
      {previewTpl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPreviewTpl(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-slate-100">Template Preview</div>
              <button onClick={() => setPreviewTpl(null)} className="text-slate-400 hover:text-slate-100">×</button>
            </div>
            <div className="text-xs text-slate-400 mb-2">{TEMPLATES[previewTpl]?.label}</div>
            {/* WhatsApp bubble style */}
            <div className="bg-[#075e54] rounded-2xl rounded-tl-none p-4">
              <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{TEMPLATES[previewTpl]?.preview}</p>
              <div className="text-[10px] text-emerald-200/70 mt-2 text-right">✓✓ Delivered</div>
            </div>
            <div className="mt-3 text-[11px] text-slate-500 italic">* Variables like &#123;name&#125; are replaced at send time</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── RuleCard ──────────────────────────────────────────────────────────────────
function RuleCard({ rule, isSelected, onSelect, onToggle, onPreview }) {
  const trigFn = TRIGGER_LABEL[rule.trigger.type];
  const trigLabel = trigFn ? trigFn(rule) : rule.trigger.type;

  return (
    <div
      className={`bg-surface/60 border rounded-xl p-4 transition-all cursor-pointer ${
        isSelected ? 'border-indigo-500/50 ring-1 ring-indigo-500/20' : 'border-slate-800/60 hover:border-slate-700/80'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        {/* Toggle */}
        <button
          onClick={e => { e.stopPropagation(); onToggle(); }}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors mt-0.5 ${rule.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${rule.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-100">{rule.name}</span>
            {!rule.enabled && <span className="text-[10px] bg-slate-700/60 border border-slate-600/40 text-slate-500 px-1.5 py-0.5 rounded">Paused</span>}
          </div>

          {/* IF → THEN flow */}
          <div className="flex items-center gap-2 text-xs mb-2 flex-wrap">
            <span className="bg-amber-500/10 border border-amber-500/25 text-amber-300 px-2 py-0.5 rounded font-mono">IF</span>
            <span className="text-slate-300">{trigLabel}</span>
            <span className="text-slate-600">→</span>
            <span className="bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 px-2 py-0.5 rounded font-mono">THEN</span>
            <span className="text-slate-300">{ACTION_LABEL[rule.action.type] || rule.action.type}</span>
          </div>

          {/* Tags + stats */}
          <div className="flex items-center gap-2 flex-wrap">
            {rule.tags.map(t => (
              <span key={t} className={`text-[11px] px-2 py-0.5 rounded border font-medium ${TAG_COLORS[t] || 'bg-slate-700/50 border-slate-600/40 text-slate-400'}`}>{t}</span>
            ))}
            <span className="text-[11px] text-slate-500 ml-auto">
              {rule.executions > 0 ? `${rule.executions} runs · ${rule.successRate}% success` : 'Not run yet'} · Last: {rule.lastRun}
            </span>
          </div>
        </div>

        {/* Preview button */}
        <button
          onClick={e => { e.stopPropagation(); onPreview(); }}
          className="text-slate-500 hover:text-indigo-400 transition-colors p-1 flex-shrink-0"
          title="Preview message template"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </div>
  );
}

// ── RuleDetail ────────────────────────────────────────────────────────────────
function RuleDetail({ rule, onClose, onPreview }) {
  const tpl = TEMPLATES[rule.action.template];

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-5">
        <span className="text-sm font-semibold text-slate-100">Rule Details</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-lg leading-none">×</button>
      </div>

      <div className="text-sm font-semibold text-slate-100 mb-1">{rule.name}</div>
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium mb-4 ${rule.enabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-700/50 border-slate-600/40 text-slate-400'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${rule.enabled ? 'bg-emerald-500' : 'bg-slate-500'}`} />
        {rule.enabled ? 'Active' : 'Paused'}
      </div>

      {/* Trigger block */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 mb-3">
        <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-1.5">Trigger (IF)</div>
        <div className="text-xs text-slate-300">
          {TRIGGER_LABEL[rule.trigger.type]?.(rule) || rule.trigger.type}
        </div>
        {rule.trigger.delay > 0 && (
          <div className="text-[11px] text-slate-500 mt-1">Delay: {rule.trigger.delay} {rule.trigger.unit}</div>
        )}
      </div>

      {/* Action block */}
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3 mb-4">
        <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-1.5">Action (THEN)</div>
        <div className="text-xs text-slate-300 mb-1">{ACTION_LABEL[rule.action.type]}</div>
        {tpl && (
          <button
            onClick={() => onPreview(rule.action.template)}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 underline-offset-2 underline"
          >
            Preview: {tpl.label}
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: 'Total executions', value: rule.executions },
          { label: 'Success rate', value: `${rule.successRate}%` },
          { label: 'Last run', value: rule.lastRun, span: true },
        ].map(s => (
          <div key={s.label} className={`bg-slate-800/40 border border-slate-700/40 rounded-lg p-3 ${s.span ? 'col-span-2' : ''}`}>
            <div className="text-sm font-bold text-slate-100">{s.value}</div>
            <div className="text-[11px] text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5">
        {rule.tags.map(t => (
          <span key={t} className={`text-[11px] px-2 py-0.5 rounded border font-medium ${TAG_COLORS[t] || 'bg-slate-700/50 border-slate-600/40 text-slate-400'}`}>{t}</span>
        ))}
      </div>
    </div>
  );
}

// ── NewRuleCard placeholder ───────────────────────────────────────────────────
function NewRuleCard({ onCancel }) {
  return (
    <div className="bg-surface/60 border-2 border-dashed border-indigo-500/30 rounded-xl p-5">
      <div className="text-sm font-semibold text-slate-200 mb-4">New Automation Rule</div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Rule Name</label>
          <input className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60" placeholder="e.g. 2nd follow-up after 48h" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Trigger</label>
            <select className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/60">
              <option>No reply for X hours</option>
              <option>Stage entered</option>
              <option>No activity for X days</option>
              <option>DSP phase changed</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Action</label>
            <select className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/60">
              <option>Send WhatsApp</option>
              <option>Send Email</option>
              <option>Tag lead</option>
              <option>Assign agent</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-all">Save Rule</button>
          <button onClick={onCancel} className="px-3 py-1.5 bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-all">Cancel</button>
          <span className="text-[11px] text-slate-500 ml-auto">UI preview only — not executed</span>
        </div>
      </div>
    </div>
  );
}
