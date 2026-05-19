// src/pages/Analytics.jsx — Analytics (route: /analytics).
// KPI tiles · funnel · source attribution · AI vs human · time-series grid · team table.
import React, { useCallback, useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { PageHeader } from '@pages/Layout';
import { analyticsAPI, campaignsAPI, reportsAPI } from '@lib/api';

// ─────────────────────────────────────────────────────────────
// Mock data
// ─────────────────────────────────────────────────────────────
const KPIS = [
  { label:'Total Leads',     value:'1,028',       delta:'+22%',  tone:'up',      sub:'vs previous 30 days' },
  { label:'Conversion Rate', value:'18.4%',       delta:'+2.1pp',tone:'up',      sub:'lead → booking confirmed' },
  { label:'Avg Deal Size',   value:'PKR 64L',     delta:'+8%',   tone:'up',      sub:'across confirmed bookings' },
  { label:'Sales Cycle',     value:'9.2 days',    delta:'-1.4d', tone:'up',      sub:'lead created → booking' },
  { label:'AI Handle Rate',  value:'92%',         delta:'+3pp',  tone:'up',      sub:'no human takeover needed' },
];

const FUNNEL = [
  { stage:'Lead',      count:1028, color:'#6366f1' },
  { stage:'Qualified', count: 612, color:'#06b6d4' },
  { stage:'Proposal',  count: 274, color:'#a855f7' },
  { stage:'Won',       count: 189, color:'#10b981' },
];

const SOURCE_PIE = [
  { name:'WhatsApp Ads',  value: 41, color:'#22c55e' },
  { name:'Facebook Ads',  value: 27, color:'#3b82f6' },
  { name:'Instagram',     value: 16, color:'#ec4899' },
  { name:'Referral',      value: 10, color:'#f59e0b' },
  { name:'Website',       value:  6, color:'#94a3b8' },
];

const AI_VS_HUMAN = [
  { metric:'Avg response',     ai: 18, human:1240, label:'sec' },
  { metric:'Conv. rate',       ai: 19, human: 24,  label:'%' },
  { metric:'Threads handled',  ai:946, human: 82,  label:'#' },
  { metric:'CSAT score',       ai:4.6, human:4.8,  label:'/5' },
];

const DAILY_LEADS = [
  { d:'Apr 21', n:32 }, { d:'Apr 22', n:38 }, { d:'Apr 23', n:41 },
  { d:'Apr 24', n:47 }, { d:'Apr 25', n:44 }, { d:'Apr 26', n:51 },
  { d:'Apr 27', n:58 },
];

const DAILY_CONVERSIONS = [
  { d:'Apr 21', n: 5 }, { d:'Apr 22', n: 7 }, { d:'Apr 23', n: 6 },
  { d:'Apr 24', n: 9 }, { d:'Apr 25', n: 8 }, { d:'Apr 26', n:11 },
  { d:'Apr 27', n:12 },
];

const AI_COST = [
  { d:'Apr 21', usd:4.82 }, { d:'Apr 22', usd:5.31 }, { d:'Apr 23', usd:5.94 },
  { d:'Apr 24', usd:6.41 }, { d:'Apr 25', usd:6.18 }, { d:'Apr 26', usd:6.92 },
  { d:'Apr 27', usd:7.10 },
];

const HOT_BY_HOUR = [
  { h:'00', n: 1 }, { h:'02', n: 0 }, { h:'04', n: 0 }, { h:'06', n: 1 },
  { h:'08', n: 4 }, { h:'10', n: 9 }, { h:'12', n:11 }, { h:'14', n:14 },
  { h:'16', n:12 }, { h:'18', n: 9 }, { h:'20', n: 6 }, { h:'22', n: 3 },
];

const TEAM = [
  { id:'t1', name:'Saad Ali',    role:'Senior Agent', leads:118, won: 22, conv:'18.6%', deal:'PKR 71L', avatar:'SA' },
  { id:'t2', name:'Hira Ahmed',  role:'Manager',      leads: 96, won: 19, conv:'19.8%', deal:'PKR 58L', avatar:'HA' },
  { id:'t3', name:'Bilal Ahmed', role:'Agent',        leads: 78, won: 11, conv:'14.1%', deal:'PKR 42L', avatar:'BA' },
];

const RANGE_OPTIONS = [
  { id:'7d',   label:'Last 7 days' },
  { id:'30d',  label:'Last 30 days' },
  { id:'90d',  label:'Last 90 days' },
  { id:'qtd',  label:'Quarter to date' },
  { id:'ytd',  label:'Year to date' },
];

// Token formatter helper
const fmtTokens = (n) => {
  if (!n) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
};

// PKR formatter for analytics tiles
const fmtPKR = (n) => {
  if (!n) return 'PKR 0';
  if (n >= 10000000) return `PKR ${(n / 10000000).toFixed(1)}cr`;
  if (n >= 100000)   return `PKR ${(n / 100000).toFixed(0)}L`;
  return `PKR ${Number(n).toLocaleString()}`;
};

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function Analytics() {
  const [range,       setRange]       = useState('30d');
  const [toast,       setToast]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [flags,       setFlags]       = useState([]);

  // State — initialised with mock constants so charts never go blank
  const [kpis,        setKpis]        = useState(KPIS);
  const [funnelData,  setFunnelData]  = useState(FUNNEL);
  const [sourcePie,   setSourcePie]   = useState(SOURCE_PIE);
  const [aiMetrics,   setAiMetrics]   = useState(AI_VS_HUMAN);
  const [dailyLeads,  setDailyLeads]  = useState(DAILY_LEADS);
  const [aiMessages,  setAiMessages]  = useState(AI_COST);
  const [teamRows,    setTeamRows]    = useState(TEAM);

  const loadData = useCallback(async (r) => {
    const days = { '7d':7, '30d':30, '90d':90, 'qtd':90, 'ytd':365 }[r] || 30;
    const from = new Date(Date.now() - days * 86400000).toISOString();
    const to   = new Date().toISOString();
    setLoading(true);

    const [ovRes, fnRes, aiRes, msgRes, teamRes] = await Promise.allSettled([
      analyticsAPI.overview({ from, to }),
      analyticsAPI.funnel({ from, to }),
      analyticsAPI.aiPerformance({ from, to }),
      analyticsAPI.messages({ from, to }),
      analyticsAPI.teamPerformance({ from, to }),
    ]);

    // ── KPIs ──────────────────────────────────────────────────
    if (ovRes.status === 'fulfilled') {
      const ov = ovRes.value.data?.data || ovRes.value.data;
      if (ov) {
        setKpis([
          { label:'Total Leads',     value:(ov.leads?.total||0).toLocaleString(),    delta:null, tone:'neutral', sub:`${ov.leads?.hot||0} hot leads this period` },
          { label:'Conversion Rate', value:ov.conversionRate||'0%',                  delta:null, tone:'up',      sub:'lead → booking confirmed' },
          { label:'Bookings Won',    value:(ov.leads?.closedWon||0).toLocaleString(), delta:null, tone:'up',      sub:'confirmed bookings' },
          { label:'AI Handle Rate',  value:ov.messages?.aiHandlingRate||'0%',        delta:null, tone:'up',      sub:'no human takeover needed' },
          { label:'AI Tokens Used',  value:fmtTokens(ov.usage?.aiTokensUsed),        delta:null, tone:'neutral', sub:`of ${fmtTokens(ov.usage?.aiTokensLimit)} limit` },
        ]);
      }
    }

    // ── Funnel ────────────────────────────────────────────────
    if (fnRes.status === 'fulfilled') {
      const arr = fnRes.value.data?.data?.funnel || fnRes.value.data?.funnel || [];
      const COLOR = { NEW:'#6366f1', QUALIFYING:'#06b6d4', DIAGNOSED:'#a855f7', PROPOSED:'#f59e0b', CLOSED_WON:'#10b981' };
      const LABEL = { NEW:'Lead', QUALIFYING:'Qualified', DIAGNOSED:'Diagnosed', PROPOSED:'Proposed', CLOSED_WON:'Won' };
      const mapped = arr.filter(f => f.stage !== 'CLOSED_LOST').map(f => ({ stage: LABEL[f.stage]||f.stage, count: f.count, color: COLOR[f.stage]||'#64748b' }));
      if (mapped.some(f => f.count > 0)) setFunnelData(mapped);
    }

    // ── AI vs Human ───────────────────────────────────────────
    if (aiRes.status === 'fulfilled') {
      const ai = aiRes.value.data?.data || aiRes.value.data;
      if (ai) {
        const hrNum = parseFloat(ai.handoffRate) || 0;
        setAiMetrics([
          { metric:'Threads handled',  ai: ai.aiMessages||0,           human: ai.handoffs||0,                label:'#'    },
          { metric:'AI retain rate',   ai: Math.round(100-hrNum),      human: Math.round(hrNum),             label:'%'    },
          { metric:'Avg lead score',   ai: ai.avgLeadScore||0,         human: 5,                             label:'/10'  },
          { metric:'Tokens used (k)',  ai: Math.round((ai.tokensUsed||0)/1000), human: 0,                   label:'k'    },
        ]);
      }
    }

    // ── Message timeline → daily inbound + AI charts ──────────
    if (msgRes.status === 'fulfilled') {
      const timeline = msgRes.value.data?.data?.timeline || msgRes.value.data?.timeline || [];
      const recent = timeline.slice(-14);
      if (recent.length > 0) {
        setDailyLeads(recent.map(d => ({ d: (d.date||'').slice(5), n: d.inbound||0 })));
        setAiMessages(recent.map(d => ({ d: (d.date||'').slice(5), usd: d.ai||0 })));
      }
    }

    // ── Team ──────────────────────────────────────────────────
    if (teamRes.status === 'fulfilled') {
      const rows = (teamRes.value.data?.data?.team || teamRes.value.data?.team || []).map(t => ({
        id:    t.agentId,
        name:  t.name,
        role:  'Agent',
        leads: t.responses,
        won:   t.closedWon,
        conv:  `${t.conversionRate}%`,
        deal:  `Resp ${t.avgResponseSeconds}s`,
        avatar:(t.name||'A').split(' ').map(s => s[0]).join('').slice(0,2),
      }));
      if (rows.length > 0) setTeamRows(rows);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData(range);
    campaignsAPI.underperforming().then(res => setFlags(res.data || [])).catch(() => {});
  }, [range, loadData]);

  const onExport = async () => {
    await reportsAPI.generate({ periodType: range === '7d' ? 'weekly' : 'monthly', from: new Date(Date.now() - 7 * 86400000).toISOString(), to: new Date().toISOString(), language: 'en' });
    setToast('Report generated and ready for WhatsApp dispatch ✓');
    setTimeout(() => setToast(null), 2400);
  };

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Pipeline performance, source attribution, and team activity for Boulevard Tower REIT."
        action={
          <div className="flex items-center gap-2">
            {loading && <span className="text-[10px] text-slate-500 animate-pulse">Refreshing…</span>}
            <DateRangePicker value={range} onChange={setRange} />
            <button
              onClick={onExport}
              className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3 py-2 text-xs font-medium text-white shadow-md shadow-accent/20 transition-transform hover:scale-[1.02]"
            >
              Export Report
            </button>
          </div>
        }
      />

      <div className="space-y-6 p-8">
        {/* Section A — KPI tiles */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {kpis.map((k) => <KpiTile key={k.label} {...k} />)}
        </section>

        {!!flags.length && (
          <section className="glass-card rounded-xl p-4 text-xs text-amber-300">
            Underperforming campaigns: {flags.map((f) => f.name).join(', ')}
          </section>
        )}

        {/* Section B — Funnel */}
        <section>
          <Funnel data={funnelData} />
        </section>

        {/* Section C — Source pie + AI vs Human */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SourceAttribution data={sourcePie} />
          <AiVsHuman metrics={aiMetrics} />
        </section>

        {/* Section D — Time-series 2x2 grid */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TimeSeriesCard title="Daily Inbound Messages" hint={`last ${range}`}  data={dailyLeads}         dataKey="n"   color="#6366f1" type="bar" />
          <TimeSeriesCard title="Daily Conversions"      hint="last 7 days"      data={DAILY_CONVERSIONS}  dataKey="n"   color="#10b981" type="line" />
          <TimeSeriesCard title="Daily AI Messages"      hint={`last ${range}`}  data={aiMessages}         dataKey="usd" color="#f59e0b" type="area" />
          <TimeSeriesCard title="Hot Leads by Hour"      hint="last 24h"         data={HOT_BY_HOUR}        dataKey="n"   color="#ef4444" type="bar" xKey="h" suffix=":00" />
        </section>

        {/* Section E — Team table */}
        <section>
          <TeamTable rows={teamRows} />
        </section>
      </div>

      <Toast text={toast} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Date range picker
// ─────────────────────────────────────────────────────────────
function DateRangePicker({ value, onChange }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
      <span className="hidden sm:inline">Range:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-dark cursor-pointer rounded-lg py-1.5 pl-2.5 pr-7 text-xs text-slate-200"
      >
        {RANGE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// KPI tile
// ─────────────────────────────────────────────────────────────
function KpiTile({ label, value, delta, tone, sub }) {
  const cls =
    tone === 'up'   ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
    tone === 'down' ? 'text-red-400 bg-red-400/10 border-red-400/20'             :
                      'text-slate-400 bg-slate-400/10 border-slate-400/20';
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        {delta && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{delta}</span>}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section B — Funnel
// ─────────────────────────────────────────────────────────────
function Funnel({ data = FUNNEL }) {
  const max = data[0]?.count || 1;
  return (
    <div className="glass-card rounded-xl">
      <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-100">Conversion Funnel</h2>
          <p className="mt-0.5 text-xs text-slate-500">Lead → Qualified → Proposal → Won (selected period).</p>
        </div>
        <span className="text-xs tabular-nums text-slate-500">{data[0]?.count || 0} → {data[data.length-1]?.count || 0}</span>
      </div>
      <div className="space-y-3 px-5 py-5">
        {data.map((f, i) => {
          const widthPct = (f.count / max) * 100;
          const dropFromPrev = i === 0 ? null : Math.round(((data[i-1].count - f.count) / Math.max(1, data[i-1].count)) * 100);
          return (
            <div key={f.stage}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-slate-300">{f.stage}</span>
                <span className="tabular-nums text-slate-400">
                  {f.count.toLocaleString()}
                  {dropFromPrev != null && <span className="ml-2 text-[10px] text-red-400">−{dropFromPrev}% drop</span>}
                </span>
              </div>
              <div className="h-7 overflow-hidden rounded-md bg-slate-800/60">
                <div
                  className="flex h-full items-center justify-end px-3 text-[11px] font-semibold text-white"
                  style={{ width:`${widthPct}%`, background:f.color }}
                >
                  {Math.round(widthPct)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section C — Source attribution donut
// ─────────────────────────────────────────────────────────────
function SourceAttribution({ data = SOURCE_PIE }) {
  return (
    <div className="glass-card flex flex-col rounded-xl">
      <div className="border-b border-slate-800/60 px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">Source Attribution</h2>
        <p className="mt-0.5 text-xs text-slate-500">Lead share by acquisition channel.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">
                {data.map((s) => <Cell key={s.name} fill={s.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background:'rgba(15,23,42,0.95)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:8, fontSize:12 }}
                labelStyle={{ color:'#94a3b8' }} itemStyle={{ color:'#f1f5f9' }}
                formatter={(v, n) => [`${v}%`, n]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex flex-col justify-center gap-2">
          {data.map((s) => (
            <li key={s.name} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background:s.color }} />
              <span className="text-slate-300">{s.name}</span>
              <span className="ml-auto tabular-nums font-medium text-slate-200">{s.value}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section C — AI vs Human comparison
// ─────────────────────────────────────────────────────────────
function AiVsHuman({ metrics = AI_VS_HUMAN }) {
  return (
    <div className="glass-card flex flex-col rounded-xl">
      <div className="border-b border-slate-800/60 px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">AI vs Human Performance</h2>
        <p className="mt-0.5 text-xs text-slate-500">Qualifier + closer agents vs human takeover threads.</p>
      </div>
      <ul className="divide-y divide-slate-800/60">
        {metrics.map((m) => {
          const aiBetter = m.metric === 'Avg response' ? m.ai < m.human : m.ai >= m.human;
          return (
            <li key={m.metric} className="grid grid-cols-12 items-center gap-3 px-5 py-3">
              <span className="col-span-4 text-xs font-medium text-slate-300">{m.metric}</span>
              <div className="col-span-4 text-right">
                <span className="text-[10px] uppercase tracking-wider text-accent">AI</span>
                <span className="ml-2 text-sm font-semibold tabular-nums text-slate-100">
                  {m.ai}
                  <span className="ml-0.5 text-[10px] text-slate-500">{m.label}</span>
                </span>
              </div>
              <div className="col-span-4 text-right">
                <span className="text-[10px] uppercase tracking-wider text-amber-300">Human</span>
                <span className="ml-2 text-sm font-semibold tabular-nums text-slate-100">
                  {m.human}
                  <span className="ml-0.5 text-[10px] text-slate-500">{m.label}</span>
                </span>
              </div>
              <span className={`col-span-12 -mt-1 text-[10px] ${aiBetter ? 'text-emerald-400' : 'text-amber-300'}`}>
                {aiBetter ? 'AI ahead on this metric' : 'Human ahead on this metric'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section D — Time-series card
// ─────────────────────────────────────────────────────────────
function TimeSeriesCard({ title, hint, data, dataKey, color, type, xKey = 'd', prefix = '', suffix = '' }) {
  return (
    <div className="glass-card flex flex-col rounded-xl">
      <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-3.5">
        <h3 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h3>
        <span className="text-[11px] text-slate-500">{hint}</span>
      </div>
      <div className="px-3 pb-4 pt-2" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          {type === 'line' ? (
            <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey={xKey} stroke="#475569" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} axisLine={{ stroke:'#1e293b' }} />
              <YAxis              stroke="#475569" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} axisLine={false} width={32} />
              <Tooltip contentStyle={{ background:'rgba(15,23,42,0.95)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:8, fontSize:12 }}
                       labelStyle={{ color:'#94a3b8' }} itemStyle={{ color:'#f1f5f9' }}
                       formatter={(v) => [`${prefix}${v}${suffix}`, '']} separator="" />
              <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r:3, fill:color }} activeDot={{ r:5 }} />
            </LineChart>
          ) : type === 'area' ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey={xKey} stroke="#475569" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} axisLine={{ stroke:'#1e293b' }} />
              <YAxis              stroke="#475569" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} axisLine={false} width={32} />
              <Tooltip contentStyle={{ background:'rgba(15,23,42,0.95)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:8, fontSize:12 }}
                       labelStyle={{ color:'#94a3b8' }} itemStyle={{ color:'#f1f5f9' }}
                       formatter={(v) => [`${prefix}${v}${suffix}`, '']} separator="" />
              <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#grad-${dataKey})`} />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey={xKey} stroke="#475569" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} axisLine={{ stroke:'#1e293b' }} />
              <YAxis              stroke="#475569" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} axisLine={false} width={32} />
              <Tooltip cursor={{ fill:'rgba(99,102,241,0.06)' }}
                       contentStyle={{ background:'rgba(15,23,42,0.95)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:8, fontSize:12 }}
                       labelStyle={{ color:'#94a3b8' }} itemStyle={{ color:'#f1f5f9' }}
                       formatter={(v) => [`${prefix}${v}${suffix}`, '']} separator="" />
              <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section E — Team performance table
// ─────────────────────────────────────────────────────────────
function TeamTable({ rows }) {
  return (
    <div className="glass-card overflow-hidden rounded-xl">
      <div className="border-b border-slate-800/60 px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">Team Performance</h2>
        <p className="mt-0.5 text-xs text-slate-500">Per-agent activity and conversion (last 30 days).</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface/40 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-5 py-2.5 font-semibold">Agent</th>
              <th className="px-5 py-2.5 font-semibold">Role</th>
              <th className="px-5 py-2.5 font-semibold">Leads handled</th>
              <th className="px-5 py-2.5 font-semibold">Bookings won</th>
              <th className="px-5 py-2.5 font-semibold">Conversion</th>
              <th className="px-5 py-2.5 font-semibold">Avg deal size</th>
            </tr>
          </thead>
          <tbody>
            {(rows || TEAM).map((t) => (
              <tr key={t.id} className="border-t border-slate-800/40 hover:bg-surface2/30">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-[10px] font-semibold">
                      {t.avatar}
                    </div>
                    <span className="text-slate-100">{t.name}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-slate-400">{t.role}</td>
                <td className="px-5 py-3 text-xs tabular-nums text-slate-200">{t.leads}</td>
                <td className="px-5 py-3 text-xs tabular-nums text-slate-200">{t.won}</td>
                <td className="px-5 py-3 text-xs tabular-nums text-emerald-300">{t.conv}</td>
                <td className="px-5 py-3 text-xs tabular-nums text-slate-200">{t.deal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────
function Toast({ text }) {
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 animate-fade-in">
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300 shadow-2xl backdrop-blur-xl">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M5 12l5 5L20 7" />
        </svg>
        {text}
      </div>
    </div>
  );
}
