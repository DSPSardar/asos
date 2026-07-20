// src/pages/Dashboard.jsx — v1.5.5 HOT Lead Alert Dashboard
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@pages/Layout';
import { leadsAPI, usersAPI } from '@lib/api';
import { DEMO_ACCESS_TOKEN, useAuthStore } from '@stores/auth.store';

// ── Poll interval ─────────────────────────────────────────────────────
const POLL_MS = 30_000;

// ── Score colours ─────────────────────────────────────────────────────
const SCORE_STYLE = {
  HOT:  { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  text: '#f87171', dot: '#ef4444' },
  WARM: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: '#fbbf24', dot: '#f59e0b' },
  COLD: { bg: 'rgba(100,116,139,0.12)',border: 'rgba(100,116,139,0.3)',text: '#94a3b8', dot: '#64748b' },
};

const PIPELINE = [
  { stage: 'New',      count: 47, color: '#6366f1' },
  { stage: 'Qual.',    count: 32, color: '#8b5cf6' },
  { stage: 'Diag.',    count: 18, color: '#a855f7' },
  { stage: 'Proposal', count: 9,  color: '#d946ef' },
  { stage: 'Won',      count: 11, color: '#10b981' },
  { stage: 'Lost',     count: 6,  color: '#475569' },
];

const DEMO_AGENTS = [
  { id: 'demo-agent', fullName: 'Saad Khan' },
  { id: 'demo-agent-2', fullName: 'AI Sales Agent' },
];

const DEMO_HOT_LEADS = [
  {
    id: 'demo-hot-1', aiScore: 94, scoreLabel: 'HOT', stage: 'PROPOSED',
    dealValue: 4200000, currency: 'PKR', updatedAt: new Date().toISOString(),
    contact: { name: 'Hassan Raza', phone: '+92 300 7654129' },
    campaign: { name: 'WhatsApp Ads' }, agent: DEMO_AGENTS[0],
    activities: [{ content: 'Ready for a payment-plan consultation.' }],
    conversations: [{ status: 'AI_HANDLING' }],
    qualificationData: { budget: 'PKR 4.2M', timeline: 'This week', authority: 'Decision maker' },
  },
  {
    id: 'demo-hot-2', aiScore: 89, scoreLabel: 'HOT', stage: 'QUALIFYING',
    dealValue: 2500000, currency: 'PKR', updatedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    contact: { name: 'Ayesha Malik', phone: '+92 321 9870034' },
    campaign: { name: 'Facebook Ads' }, agent: DEMO_AGENTS[1],
    activities: [{ content: 'Requested a consultation tomorrow at 3 PM.' }],
    conversations: [{ status: 'AI_HANDLING' }],
    qualificationData: { budget: 'PKR 2.5M', timeline: 'This month', authority: 'Decision maker' },
  },
  {
    id: 'demo-hot-3', aiScore: 86, scoreLabel: 'HOT', stage: 'DIAGNOSED',
    dealValue: 6000000, currency: 'PKR', updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    contact: { name: 'Maryam Ali', phone: '+92 308 1122334' },
    campaign: { name: 'Instagram' }, agent: DEMO_AGENTS[0],
    activities: [{ content: 'Asked for booking documents and next steps.' }],
    conversations: [{ status: 'NEEDS_HUMAN' }],
    qualificationData: { budget: 'PKR 6M', timeline: 'Today', authority: 'Decision maker' },
  },
];

const DEMO_HANDOFF = [
  {
    id: 'demo-handoff-1', status: 'NEEDS_HUMAN', lastMessageAt: new Date().toISOString(),
    lead: DEMO_HOT_LEADS[2],
  },
];

// ── Main page ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const isDemo = useAuthStore((state) => state.token === DEMO_ACCESS_TOKEN);
  const [hotLeads,    setHotLeads]    = useState([]);
  const [handoff,     setHandoff]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState('hot');   // 'hot' | 'handoff'
  const [filter,      setFilter]      = useState({ score: '', source: '', assigned: '' });
  const [drawer,      setDrawer]      = useState(null);    // lead object
  const [toasts,      setToasts]      = useState([]);
  const [agents,      setAgents]      = useState([]);
  const prevHotIds    = useRef(new Set());

  const addToast = useCallback((msg, type = 'hot') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);

  const fetchData = useCallback(async (isFirst = false) => {
    if (isDemo) {
      setHotLeads(DEMO_HOT_LEADS);
      setHandoff(DEMO_HANDOFF);
      setLoading(false);
      return;
    }

    try {
      const [hotRes, handoffRes] = await Promise.all([
        leadsAPI.hot(50),
        leadsAPI.handoff(),
      ]);
      const hot = hotRes?.data ?? hotRes ?? [];
      const hq  = handoffRes?.data ?? handoffRes ?? [];

      if (!isFirst) {
        const newIds = hot.filter(l => !prevHotIds.current.has(l.id));
        newIds.forEach(l => addToast(`🔥 New HOT lead: ${l.contact?.name || l.id}`, 'hot'));
      }
      prevHotIds.current = new Set(hot.map(l => l.id));

      setHotLeads(hot);
      setHandoff(hq);
    } catch {
      // silently fail — don't disrupt dashboard on API errors
    } finally {
      setLoading(false);
    }
  }, [addToast, isDemo]);

  useEffect(() => {
    fetchData(true);
    if (isDemo) {
      setAgents(DEMO_AGENTS);
      return undefined;
    }

    usersAPI.list().then(r => setAgents(r?.data ?? r ?? [])).catch(() => {});
    const t = setInterval(() => fetchData(false), POLL_MS);
    return () => clearInterval(t);
  }, [fetchData, isDemo]);

  const filteredHot = hotLeads.filter(l => {
    if (filter.score    && l.scoreLabel !== filter.score)          return false;
    if (filter.source   && l.campaign?.name !== filter.source)     return false;
    if (filter.assigned && l.agent?.id !== filter.assigned)        return false;
    return true;
  });

  const sources = [...new Set(hotLeads.map(l => l.campaign?.name).filter(Boolean))];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Live HOT lead feed — updated every 30 seconds."
        action={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Live · {POLL_MS / 1000}s refresh
            </span>
            <button onClick={() => fetchData(false)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500 hover:text-white">
              ↺ Refresh
            </button>
          </div>
        }
      />

      {/* Toast stack */}
      <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id}
               className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-slate-900/95 px-4 py-3 text-sm text-red-300 shadow-xl backdrop-blur animate-fade-in"
               style={{ minWidth: 280 }}>
            <span className="text-base">🔥</span>
            <span>{t.msg}</span>
            <button onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))}
                    className="ml-auto text-slate-500 hover:text-slate-300">×</button>
          </div>
        ))}
      </div>

      <div className="space-y-6 p-6">

        {/* ── KPI row ── */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTile label="HOT Leads"      value={hotLeads.length}           delta="Live" deltaTone="hot"     subtitle="needs action now" />
          <KpiTile label="Handoff Queue"  value={handoff.length}            delta="⚠ Human" deltaTone="warn" subtitle="AI passed to human" />
          <KpiTile label="Total Active"   value={hotLeads.length + handoff.length} delta="" deltaTone="neutral" subtitle="in pipeline" />
          <KpiTile label="Avg AI Score"   value={hotLeads.length ? Math.round(hotLeads.reduce((s, l) => s + (l.aiScore || 0), 0) / hotLeads.length) + '/100' : '—'}
                   delta="" deltaTone="neutral" subtitle="HOT leads only" />
        </section>

        {/* ── Main panel ── */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">

          {/* HOT Leads + Handoff Queue */}
          <div className="glass-card rounded-xl xl:col-span-2">
            {/* Tab bar + filters */}
            <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-3 flex-wrap gap-2">
              <div className="flex gap-1">
                {[['hot', `🔥 HOT Leads (${hotLeads.length})`], ['handoff', `⚠ Handoff Queue (${handoff.length})`]].map(([tab, label]) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                            activeTab === tab
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}>
                    {label}
                  </button>
                ))}
              </div>
              {/* Filters */}
              {activeTab === 'hot' && (
                <div className="flex items-center gap-2">
                  <select value={filter.score} onChange={e => setFilter(f => ({ ...f, score: e.target.value }))}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 outline-none">
                    <option value="">All scores</option>
                    <option value="HOT">🔥 HOT</option>
                    <option value="WARM">🟡 WARM</option>
                    <option value="COLD">🔵 COLD</option>
                  </select>
                  <select value={filter.source} onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 outline-none">
                    <option value="">All sources</option>
                    {sources.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={filter.assigned} onChange={e => setFilter(f => ({ ...f, assigned: e.target.value }))}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 outline-none">
                    <option value="">All agents</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.fullName}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Content */}
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <span className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-500/30 border-t-indigo-400" />
              </div>
            ) : activeTab === 'hot' ? (
              filteredHot.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500">No HOT leads right now. AI is qualifying…</div>
              ) : (
                <ul className="divide-y divide-slate-800/50">
                  {filteredHot.map(lead => (
                    <HotLeadRow key={lead.id} lead={lead} onOpen={() => setDrawer(lead)} />
                  ))}
                </ul>
              )
            ) : (
              handoff.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500">No leads in handoff queue.</div>
              ) : (
                <ul className="divide-y divide-slate-800/50">
                  {handoff.map(conv => (
                    <HandoffRow key={conv.id} conv={conv} agents={agents}
                                onAssign={(agentId) => leadsAPI.assign(conv.lead?.id, agentId).then(() => fetchData())} />
                  ))}
                </ul>
              )
            )}
          </div>

          {/* Pipeline snapshot */}
          <PipelineSnapshot />
        </section>
      </div>

      {/* Lead drawer */}
      {drawer && (
        <LeadDrawer lead={drawer} agents={agents}
                    onClose={() => setDrawer(null)}
                    onAssign={(agentId) => leadsAPI.assign(drawer.id, agentId).then(() => { fetchData(); setDrawer(null); })}
                    onStage={(stage) => leadsAPI.updateStage(drawer.id, stage).then(() => { fetchData(); setDrawer(null); })} />
      )}
    </>
  );
}

// ── HOT lead row ──────────────────────────────────────────────────────
function HotLeadRow({ lead, onOpen }) {
  const s = SCORE_STYLE[lead.scoreLabel] || SCORE_STYLE.COLD;
  const lastActivity = lead.activities?.[0];
  const conv = lead.conversations?.[0];

  return (
    <li className="group flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors hover:bg-slate-800/30"
        onClick={onOpen}>
      {/* Score badge */}
      <div className="mt-0.5 flex-shrink-0 flex flex-col items-center gap-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold"
             style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text }}>
          {lead.aiScore || '—'}
        </div>
        <span className="text-[9px] font-semibold uppercase" style={{ color: s.dot }}>
          {lead.scoreLabel}
        </span>
      </div>

      {/* Main info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-slate-100">{lead.contact?.name || 'Unknown'}</span>
          <span className="text-xs text-slate-500">{lead.contact?.phone}</span>
          {lead.campaign && (
            <span className="rounded-full bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] text-indigo-300">
              {lead.campaign.name}
            </span>
          )}
          {conv?.status === 'NEEDS_HUMAN' && (
            <span className="rounded-full bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 text-[10px] text-amber-300">
              ⚠ Needs human
            </span>
          )}
        </div>
        {lastActivity && (
          <p className="mt-1 truncate text-xs text-slate-400">{lastActivity.content}</p>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-600">
          <span>Stage: <span className="text-slate-400">{lead.stage}</span></span>
          {lead.agent && <span>Agent: <span className="text-slate-400">{lead.agent.fullName}</span></span>}
          <span>{timeAgo(lead.updatedAt)}</span>
        </div>
      </div>

      <ChevronRight className="mt-3 h-4 w-4 flex-shrink-0 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100" />
    </li>
  );
}

// ── Handoff queue row ─────────────────────────────────────────────────
function HandoffRow({ conv, agents, onAssign }) {
  const lead = conv.lead;
  const [assigning, setAssigning] = useState(false);
  const [agentId, setAgentId] = useState(lead?.agent?.id || '');

  const handleAssign = async () => {
    if (!agentId) return;
    setAssigning(true);
    try { await onAssign(agentId); } finally { setAssigning(false); }
  };

  return (
    <li className="flex items-start gap-4 px-5 py-4">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-400/10 border border-amber-400/25">
        <span className="text-base">⚠</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-slate-100">{lead?.contact?.name || 'Unknown'}</span>
          <span className="text-xs text-slate-500">{lead?.contact?.phone}</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          AI handed off · {timeAgo(conv.lastMessageAt || conv.createdAt)}
          {lead?.campaign && <span> · {lead.campaign.name}</span>}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <select value={agentId} onChange={e => setAgentId(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 outline-none">
            <option value="">Pick agent…</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.fullName}</option>)}
          </select>
          <button onClick={handleAssign} disabled={!agentId || assigning}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40">
            {assigning ? 'Assigning…' : 'Assign'}
          </button>
          <a href={`https://wa.me/${lead?.contact?.phone?.replace(/\D/g, '')}`}
             target="_blank" rel="noreferrer"
             className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400 transition hover:bg-emerald-500/20">
            WhatsApp
          </a>
        </div>
      </div>
    </li>
  );
}

// ── Lead Detail Drawer ────────────────────────────────────────────────
function LeadDrawer({ lead, agents, onClose, onAssign, onStage }) {
  const [agentId, setAgentId] = useState(lead.agent?.id || '');
  const [busy, setBusy] = useState(false);
  const s = SCORE_STYLE[lead.scoreLabel] || SCORE_STYLE.COLD;

  const doAssign = async () => {
    if (!agentId) return;
    setBusy(true);
    try { await onAssign(agentId); } finally { setBusy(false); }
  };

  const doStage = async (stage) => {
    setBusy(true);
    try { await onStage(stage); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden bg-slate-900 border-l border-slate-800 shadow-2xl"
           style={{ animation: 'slideIn 0.2s ease' }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-sm"
                 style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text }}>
              {lead.aiScore || '—'}
            </div>
            <div>
              <div className="font-semibold text-slate-100">{lead.contact?.name || 'Unknown'}</div>
              <div className="text-xs text-slate-500">{lead.contact?.phone}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Score breakdown */}
          <Section title="Score Breakdown">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['AI Score', `${lead.aiScore || 0}/100`],
                ['Label',    lead.scoreLabel || '—'],
                ['Stage',    lead.stage || '—'],
                ['Deal',     lead.dealValue ? `${lead.currency || '$'} ${Number(lead.dealValue).toLocaleString()}` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-800/60 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{v}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* Qualification data */}
          {lead.qualificationData && Object.keys(lead.qualificationData).length > 0 && (
            <Section title="Qualification Data">
              <dl className="space-y-2">
                {Object.entries(lead.qualificationData).map(([k, v]) => v && (
                  <div key={k} className="flex items-start gap-2">
                    <dt className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-slate-500 pt-0.5">{k}</dt>
                    <dd className="text-xs text-slate-300">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          {/* Conversations */}
          {lead.conversations?.length > 0 && (
            <Section title="Recent Conversations">
              {lead.conversations.map(c => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg bg-slate-800/50 px-3 py-2">
                  <span className={`h-2 w-2 rounded-full ${c.aiEnabled ? 'bg-indigo-400' : 'bg-amber-400'}`} />
                  <span className="text-xs text-slate-300">{c.status}</span>
                  <span className="ml-auto text-[10px] text-slate-500">{timeAgo(c.lastMessageAt)}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Audit trail */}
          {lead.activities?.length > 0 && (
            <Section title="Audit Trail">
              <ol className="relative border-l border-slate-700/60 pl-4 space-y-3">
                {lead.activities.map(a => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[18px] top-1 h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-indigo-500" />
                    <div className="text-xs text-slate-300">{a.content}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{timeAgo(a.createdAt)} · {a.type}</div>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {/* Assign agent */}
          <Section title="Assign Agent">
            <div className="flex gap-2">
              <select value={agentId} onChange={e => setAgentId(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 outline-none">
                <option value="">Select agent…</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.fullName}</option>)}
              </select>
              <button onClick={doAssign} disabled={!agentId || busy}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
                {busy ? '…' : 'Assign'}
              </button>
            </div>
          </Section>
        </div>

        {/* Action footer */}
        <div className="border-t border-slate-800 px-5 py-4">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <a href={`tel:${lead.contact?.phone}`}
               className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-sm font-medium text-slate-300 transition hover:border-indigo-400 hover:text-white">
              📞 Call
            </a>
            <a href={`https://wa.me/${lead.contact?.phone?.replace(/\D/g, '')}`}
               target="_blank" rel="noreferrer"
               className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/20">
              WhatsApp
            </a>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => doStage('CLOSED_WON')} disabled={busy}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-40">
              ✓ Mark Won
            </button>
            <button onClick={() => doStage('CLOSED_LOST')} disabled={busy}
                    className="rounded-xl border border-red-500/30 bg-red-500/10 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-40">
              ✗ Mark Lost
            </button>
          </div>
        </div>
      </div>

      <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
    </div>
  );
}

// ── Pipeline snapshot ─────────────────────────────────────────────────
function PipelineSnapshot() {
  const total = PIPELINE.reduce((s, p) => s + p.count, 0);
  return (
    <div className="glass-card rounded-xl">
      <SectionHeader title="Pipeline Snapshot" hint={`${total} active`} cta="Open leads →" ctaHref="/leads" />
      <div className="h-56 px-3 pb-4 pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={PIPELINE} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="22%">
            <XAxis dataKey="stage" stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#1e293b' }} />
            <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
            <Tooltip cursor={{ fill: 'rgba(99,102,241,0.06)' }}
                     contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8, fontSize: 12 }}
                     labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#f1f5f9' }}
                     formatter={(v) => [`${v} leads`, '']} separator="" />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {PIPELINE.map((p, i) => <Cell key={i} fill={p.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-slate-800/60 px-5 py-3">
        {PIPELINE.map(p => (
          <div key={p.stage} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
            <span className="text-[11px] text-slate-400">{p.stage}</span>
            <span className="ml-auto text-[11px] tabular-nums font-medium text-slate-200">{p.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── KPI tile ──────────────────────────────────────────────────────────
function KpiTile({ label, value, delta, deltaTone, subtitle }) {
  const tone =
    deltaTone === 'up'  ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
    deltaTone === 'hot' ? 'text-red-400 bg-red-400/10 border-red-400/20' :
    deltaTone === 'warn'? 'text-amber-400 bg-amber-400/10 border-amber-400/20' :
                          'text-slate-400 bg-slate-400/10 border-slate-400/20';
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        {delta && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}>{delta}</span>}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

// ── Shared section header ─────────────────────────────────────────────
function SectionHeader({ title, hint, cta, ctaHref }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h2>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {cta && <a href={ctaHref} className="text-xs text-slate-500 transition-colors hover:text-accent">{cta}</a>}
    </div>
  );
}

// ── Chevron icon ──────────────────────────────────────────────────────
function ChevronRight({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ── Time ago helper ───────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
