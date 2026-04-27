// src/pages/AIInsights.jsx — AI Insights (route: /ai-insights).
// Buying-signal feed + sentiment chart + weekly digest. Boulevard Tower REIT context.
import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { PageHeader } from '@pages/Layout';

// ─────────────────────────────────────────────────────────────
// Mock data
// ─────────────────────────────────────────────────────────────
const KPI_INSIGHTS = [
  { label:'Hot Buying Signals',     value:'14',   delta:'+5 this week', tone:'up',
    sub:'Leads showing strong intent — pricing / consultation asks' },
  { label:'At-Risk Conversations',  value:'6',    delta:'2 unread',     tone:'down',
    sub:'Stalled > 48h or negative sentiment detected' },
  { label:'AI Performance Score',   value:'92',   delta:'+3pp',         tone:'up',
    sub:'Reply quality + qualification accuracy (last 7d)' },
  { label:'Recommended Actions',    value:'9',    delta:'Open queue',   tone:'neutral',
    sub:'AI-suggested next steps awaiting human review' },
];

const SIGNAL_STYLES = {
  PRICING:        { label:'Pricing inquiry',     pill:'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  DOWNPAYMENT:    { label:'Downpayment Q',       pill:'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  APPROVALS:      { label:'Approvals check',     pill:'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  RETURNS:        { label:'IRR / appreciation',  pill:'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  ALLOTMENT:      { label:'Allotment status',    pill:'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  TRACK_RECORD:   { label:'Developer credibility',pill:'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  CONSULTATION:   { label:'Consultation ask',    pill:'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  HNWI:           { label:'HNWI ticket',         pill:'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' },
  RISK:           { label:'At-risk',             pill:'bg-red-500/15 text-red-300 border-red-500/30' },
};

const SIGNALS = [
  { id:'s1',  name:'Maryam Ali',     type:'CONSULTATION',  conf:96, snippet:'60 lakh tak. Aaj evening consultation possible hai? 5 PM?',
    action:'Schedule consultation call (5 PM slot reserved)', primary:'Book call' },
  { id:'s2',  name:'Hassan Raza',    type:'HNWI',          conf:94, snippet:'Sir 4 cr ke shop units + sharing basis ke terms confirm karwa dein.',
    action:'Escalate to senior agent — finalize sharing-basis term sheet', primary:'Escalate' },
  { id:'s3',  name:'Ahmed Khan',     type:'PRICING',       conf:91, snippet:'1 unit means kya? 100 sft? Itna chota?',
    action:'Send 100 sft / 18,000 sft starter explainer + payment plan PDF', primary:'Send PDF' },
  { id:'s4',  name:'Ayesha Malik',   type:'RETURNS',       conf:90, snippet:'PSX listing 3 saal mein? Pehle exit ka option hai?',
    action:'Send IRR projection PDF (31% IRR, 30-50% capital appreciation)', primary:'Send PDF' },
  { id:'s5',  name:'Fatima Sheikh',  type:'APPROVALS',     conf:88, snippet:'RDA aur CDC approval ke documents ka wait karti hoon.',
    action:'Email RDA / CDC / SECP approval letters + NOC bundle', primary:'Send approvals' },
  { id:'s6',  name:'Tariq Hussain',  type:'HNWI',          conf:87, snippet:'1.2 crore allocation karna hai. Multiple shop units possible hain?',
    action:'Escalate to senior agent for HNWI — multi-unit shop allocation', primary:'Escalate' },
  { id:'s7',  name:'Bilal Ahmed',    type:'TRACK_RECORD',  conf:84, snippet:'Sardar Group woh hai jisne Centaurus banaya tha?',
    action:'Share Sardar Group / Centaurus Mall track record + delivered projects list', primary:'Share track record' },
  { id:'s8',  name:'Faisal Khan',    type:'DOWNPAYMENT',   conf:82, snippet:'80 lakh ke entire 2-bed pe 20% down ke baad monthly kitni banegi?',
    action:'Send installment calculator (20% down + 42-month plan)', primary:'Send calculator' },
  { id:'s9',  name:'Usman Ali',      type:'ALLOTMENT',     conf:97, snippet:'Downpayment debit ho gayi but allotment letter nahi mila!',
    action:'URGENT — escalate to senior agent, reconcile IBFT, issue allotment letter', primary:'Escalate now' },
  { id:'s10', name:'Sana Tariq',     type:'RISK',          conf:79, snippet:'PSX listing 3 saal door hai. Mujhe ready property chahiye.',
    action:'Mark LOST or nurture — re-engage when ready-stage launch announced', primary:'Move to LOST' },
];

const SENTIMENT_TREND = [
  { day:'Mon', positive:62, neutral:31, negative: 7 },
  { day:'Tue', positive:65, neutral:28, negative: 7 },
  { day:'Wed', positive:58, neutral:33, negative: 9 },
  { day:'Thu', positive:71, neutral:24, negative: 5 },
  { day:'Fri', positive:74, neutral:21, negative: 5 },
  { day:'Sat', positive:68, neutral:26, negative: 6 },
  { day:'Sun', positive:72, neutral:23, negative: 5 },
];

const DIGEST_BULLETS = [
  'Hot signal volume up 56% week-over-week — IRR / 100 sft questions dominate inbound.',
  'AI handled 92% of inbound threads; only 8 escalations to human (most: HNWI tickets > 1 cr).',
  'Top conversion driver: leads who saw the Sardar Group / Centaurus track record reply within 5 minutes.',
  '6 conversations stalled > 48h — suggest re-engaging with payment-plan calculator + RDA/CDC/SECP approvals bundle.',
  '1 high-priority risk: Usman Ali (downpayment debited, allotment letter pending) — must resolve in 24h.',
];

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function AIInsights() {
  return (
    <>
      <PageHeader
        title="AI Insights"
        subtitle="What the AI is seeing across your inbox — buying signals, sentiment, and recommended actions."
        action={
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 glow-green" />
            Refreshed just now · last 7 days
          </div>
        }
      />

      <div className="space-y-6 p-8">
        {/* Section A — KPI insight cards */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {KPI_INSIGHTS.map((k) => <KpiInsight key={k.label} {...k} />)}
        </section>

        {/* Section B + C side by side on wide screens */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <SignalsFeed   className="lg:col-span-3" />
          <SentimentChart className="lg:col-span-2" />
        </section>

        {/* Section D — Weekly insights digest */}
        <section>
          <DigestBox />
        </section>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// KPI insight card
// ─────────────────────────────────────────────────────────────
function KpiInsight({ label, value, delta, tone, sub }) {
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
// Section B — Buying signals feed
// ─────────────────────────────────────────────────────────────
function SignalsFeed({ className = '' }) {
  return (
    <div className={`glass-card rounded-xl ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-100">Buying Signals</h2>
          <p className="mt-0.5 text-xs text-slate-500">Top intent signals from the last 7 days. Sorted by AI confidence.</p>
        </div>
        <span className="text-xs text-slate-500">{SIGNALS.length} signals</span>
      </div>
      <ul className="divide-y divide-slate-800/60">
        {SIGNALS.map((s) => <SignalRow key={s.id} signal={s} />)}
      </ul>
    </div>
  );
}

function SignalRow({ signal }) {
  const style = SIGNAL_STYLES[signal.type] || SIGNAL_STYLES.PRICING;
  return (
    <li className="px-5 py-3.5 transition-colors hover:bg-surface2/40">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-xs font-semibold text-slate-200">
          {initials(signal.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-100">{signal.name}</span>
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${style.pill}`}>
              {style.label}
            </span>
            <ConfidenceBar pct={signal.conf} />
          </div>
          <div className="mt-1 truncate text-xs italic text-slate-300">"{signal.snippet}"</div>
          <div className="mt-1.5 text-xs text-slate-400">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Recommended: </span>
            {signal.action}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            onClick={() => alert(`Demo: would ${signal.primary.toLowerCase()} for ${signal.name}`)}
            className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20"
          >
            {signal.primary}
          </button>
          <button
            onClick={() => alert(`Demo: would dismiss signal for ${signal.name}`)}
            className="rounded-md border border-slate-700/60 bg-transparent px-2.5 py-1 text-[11px] text-slate-400 hover:bg-surface2/60"
          >
            Dismiss
          </button>
        </div>
      </div>
    </li>
  );
}

function ConfidenceBar({ pct }) {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-slate-500">
      <span className="h-1 w-14 overflow-hidden rounded-full bg-slate-800">
        <span className="block h-full rounded-full bg-gradient-to-r from-accent to-accent2" style={{ width:`${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Section C — Sentiment chart (stacked area)
// ─────────────────────────────────────────────────────────────
function SentimentChart({ className = '' }) {
  return (
    <div className={`glass-card flex flex-col rounded-xl ${className}`}>
      <div className="border-b border-slate-800/60 px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">Sentiment (last 7 days)</h2>
        <p className="mt-0.5 text-xs text-slate-500">% of inbound messages classified positive / neutral / negative.</p>
      </div>
      <div className="flex-1 px-3 pb-4 pt-2" style={{ minHeight: 280 }}>
        <ResponsiveContainer width="100%" height="100%" minHeight={280}>
          <AreaChart data={SENTIMENT_TREND} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} stackOffset="expand">
            <defs>
              <linearGradient id="grPos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#10b981" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.25} />
              </linearGradient>
              <linearGradient id="grNeu" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#64748b" stopOpacity={0.7} />
                <stop offset="100%" stopColor="#64748b" stopOpacity={0.2} />
              </linearGradient>
              <linearGradient id="grNeg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.85} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.2} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="day"   stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={{ stroke:'#1e293b' }} />
            <YAxis              stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false}
              tickFormatter={(v) => `${Math.round(v * 100)}%`} width={36} />
            <Tooltip
              contentStyle={{ background:'rgba(15,23,42,0.95)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:8, fontSize:12 }}
              labelStyle={{ color:'#94a3b8' }} itemStyle={{ color:'#f1f5f9' }}
              formatter={(v, k) => [`${v}%`, k]}
            />
            <Area type="monotone" dataKey="positive" stackId="1" stroke="#10b981" fill="url(#grPos)" />
            <Area type="monotone" dataKey="neutral"  stackId="1" stroke="#64748b" fill="url(#grNeu)" />
            <Area type="monotone" dataKey="negative" stackId="1" stroke="#ef4444" fill="url(#grNeg)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-slate-800/60 px-5 py-3 text-xs">
        <Legend color="#10b981" label="Positive" />
        <Legend color="#64748b" label="Neutral" />
        <Legend color="#ef4444" label="Negative" />
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-400">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Section D — Weekly insights digest
// ─────────────────────────────────────────────────────────────
function DigestBox() {
  return (
    <div className="glass-card rounded-xl">
      <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-100">Weekly Insights Digest</h2>
          <p className="mt-0.5 text-xs text-slate-500">Auto-generated every Monday 9 AM PKT. Here's what AI noticed last week.</p>
        </div>
        <button
          onClick={() => alert('Demo: would email digest to team')}
          className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20"
        >
          Email digest →
        </button>
      </div>
      <ul className="space-y-2.5 px-5 py-4">
        {DIGEST_BULLETS.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-300">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function initials(name = '') {
  return name.split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
}
