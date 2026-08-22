// src/pages/AIInsights.jsx — AI Insights (route: /ai-insights).
// Live mode: real tenant data from /leads/hot + /leads/handoff.
// Demo mode: canned DSP AI Agents Bootcamp walkthrough (sales demos only).
import React, { useCallback, useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@pages/Layout';
import { insightsAPI, leadsAPI } from '@lib/api';
import { DEMO_ACCESS_TOKEN, useAuthStore } from '@stores/auth.store';

// ─────────────────────────────────────────────────────────────
// Demo data — rendered ONLY for the demo account. Live tenants
// never see these numbers.
// ─────────────────────────────────────────────────────────────
const DEMO_KPI_INSIGHTS = [
  { label:'Hot Buying Signals',     value:'14',   delta:'+5 this week', tone:'up',
    sub:'Leads showing strong intent — fee / enrollment asks' },
  { label:'At-Risk Conversations',  value:'6',    delta:'2 unread',     tone:'down',
    sub:'Stalled > 48h or negative sentiment detected' },
  { label:'AI Performance Score',   value:'92',   delta:'+3pp',         tone:'up',
    sub:'Reply quality + qualification accuracy (last 7d)' },
  { label:'Recommended Actions',    value:'9',    delta:'Open queue',   tone:'neutral',
    sub:'AI-suggested next steps awaiting human review' },
];

const SIGNAL_STYLES = {
  PRICING:      { label:'Fee inquiry',          pill:'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  INSTALLMENT:  { label:'Installment Q',        pill:'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  BATCH:        { label:'Batch schedule',       pill:'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  CAREER:       { label:'Career outcome',       pill:'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  PAYMENT:      { label:'Payment issue',        pill:'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  TRACK_RECORD: { label:'Trainer credibility',  pill:'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  CONSULTATION: { label:'Consultation ask',     pill:'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  CORPORATE:    { label:'Corporate ticket',     pill:'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' },
  ENROLLMENT:   { label:'Ready to enroll',      pill:'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  RISK:         { label:'At-risk',              pill:'bg-red-500/15 text-red-300 border-red-500/30' },
};

const DEMO_SIGNALS = [
  { id:'s1',  name:'Maryam Ali',     type:'ENROLLMENT',   conf:96, snippet:'Fee structure clear hai. Aaj hi enroll karna chahti hoon — payment details bhej dein?',
    action:'Send payment instructions + reserve seat in the next batch', primary:'Send payment info' },
  { id:'s2',  name:'Hassan Raza',    type:'CORPORATE',    conf:94, snippet:'Apni company ki team ke liye AI agents ki corporate training chahiye. Terms discuss kar lein?',
    action:'Escalate to Sardar — corporate training package, custom quote', primary:'Escalate' },
  { id:'s3',  name:'Ahmed Khan',     type:'PRICING',      conf:91, snippet:'Bootcamp ki total fee kitni hai? Kya kuch discount possible hai?',
    action:'Send fee structure + current-batch offer PDF', primary:'Send fees' },
  { id:'s4',  name:'Ayesha Malik',   type:'CAREER',       conf:90, snippet:'Course ke baad clients kaise milenge? Freelancing ya job — kya realistic hai?',
    action:'Share alumni success stories + freelancing roadmap', primary:'Send roadmap' },
  { id:'s5',  name:'Fatima Sheikh',  type:'BATCH',        conf:88, snippet:'Next batch kab start ho raha hai? Weekend ya evening classes hain?',
    action:'Send batch calendar + Zoom session timings', primary:'Send schedule' },
  { id:'s6',  name:'Tariq Hussain',  type:'CORPORATE',    conf:87, snippet:'Office ke 5 logon ke liye seats chahiye. Group discount milega?',
    action:'Escalate to Sardar — group enrollment, 5 seats', primary:'Escalate' },
  { id:'s7',  name:'Bilal Ahmed',    type:'TRACK_RECORD', conf:84, snippet:'Sir aap Google aur Anthropic verified trainer hain? Certificate bhi milta hai?',
    action:'Share trainer credentials (Google + Claude verified) + certificate sample', primary:'Share credentials' },
  { id:'s8',  name:'Faisal Khan',    type:'INSTALLMENT',  conf:82, snippet:'Fee 2 installments mein ho sakti hai? Pehli installment kitni hogi?',
    action:'Send installment breakdown (2-part plan) + payment deadline', primary:'Send plan' },
  { id:'s9',  name:'Usman Ali',      type:'PAYMENT',      conf:97, snippet:'Payment kar di, screenshot bhi bheja — abhi tak student group mein add nahi kiya!',
    action:'URGENT — verify payment screenshot, add to student group, send onboarding', primary:'Resolve now' },
  { id:'s10', name:'Sana Tariq',     type:'RISK',         conf:79, snippet:'Fee zyada lag rahi hai. YouTube pe free courses bhi to hain.',
    action:'Nurture — invite to free masterclass, re-engage before batch deadline', primary:'Send masterclass' },
];

const DEMO_SENTIMENT_TREND = [
  { day:'Mon', positive:62, neutral:31, negative: 7 },
  { day:'Tue', positive:65, neutral:28, negative: 7 },
  { day:'Wed', positive:58, neutral:33, negative: 9 },
  { day:'Thu', positive:71, neutral:24, negative: 5 },
  { day:'Fri', positive:74, neutral:21, negative: 5 },
  { day:'Sat', positive:68, neutral:26, negative: 6 },
  { day:'Sun', positive:72, neutral:23, negative: 5 },
];

const DEMO_DIGEST_BULLETS = [
  'Hot signal volume up 56% week-over-week — fee and installment questions dominate inbound.',
  'AI handled 92% of inbound threads; only 8 escalations to human (most: corporate training inquiries).',
  'Top conversion driver: leads who got the trainer-credentials reply within 5 minutes.',
  '6 conversations stalled > 48h — suggest re-engaging with the installment plan + next-batch deadline.',
  '1 high-priority risk: Usman Ali (payment received, not yet added to student group) — must resolve in 24h.',
];

// Live-mode stage pill styles
const STAGE_PILLS = {
  NEEDS_HUMAN: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
  NEW:         'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  QUALIFYING:  'bg-violet-500/15 text-violet-300 border-violet-500/30',
  DIAGNOSED:   'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  PROPOSED:    'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
};

// ─────────────────────────────────────────────────────────────
// Page — demo account gets the walkthrough, everyone else live data
// ─────────────────────────────────────────────────────────────
export default function AIInsights() {
  const isDemo = useAuthStore((s) => s.token === DEMO_ACCESS_TOKEN);
  return isDemo ? <DemoInsights /> : <LiveInsights />;
}

// ───────────────────────────── Live ──────────────────────────
function LiveInsights() {
  const navigate = useNavigate();
  const [hot, setHot]         = useState(null);   // null = loading
  const [handoff, setHandoff] = useState([]);
  const [sentiment, setSentiment] = useState(null); // { trend, sampleSize }
  const [digest, setDigest]       = useState(null); // { bullets, ... }
  const [error, setError]     = useState(false);

  const load = useCallback(() => {
    Promise.all([leadsAPI.hot(50), leadsAPI.handoff()])
      .then(([hotRes, hqRes]) => {
        setHot(hotRes?.data ?? hotRes ?? []);
        setHandoff(hqRes?.data ?? hqRes ?? []);
        setError(false);
      })
      .catch(() => {
        setError(true);
        setHot((h) => h ?? []);
      });
    // Classification endpoints are newer — fetched separately so an error
    // here never blanks the lead-based sections above.
    insightsAPI.sentiment()
      .then((r) => setSentiment(r?.data ?? r ?? null))
      .catch(() => setSentiment(null));
    insightsAPI.digest()
      .then((r) => setDigest(r?.data ?? r ?? null))
      .catch(() => setDigest(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (hot === null) {
    return (
      <>
        <InsightsHeader note="Loading…" />
        <div className="flex items-center justify-center py-24">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-500/30 border-t-indigo-400" />
        </div>
      </>
    );
  }

  const needsHuman = hot.filter((l) => l.conversations?.[0]?.status === 'NEEDS_HUMAN').length;
  const avgScore   = hot.length ? Math.round(hot.reduce((s, l) => s + (l.aiScore || 0), 0) / hot.length) : 0;

  const kpis = [
    { label:'Hot Buying Signals', value:String(hot.length), delta:'Live', tone:'up',
      sub:'HOT-scored leads active in your pipeline' },
    { label:'Handoff Queue', value:String(handoff.length), delta: handoff.length ? '⚠ Human' : '', tone:'down',
      sub:'Conversations the AI passed to a human' },
    { label:'Needs Human Now', value:String(needsHuman), delta:'', tone:'neutral',
      sub:'HOT leads flagged NEEDS_HUMAN' },
    { label:'Avg AI Score', value: hot.length ? `${avgScore}/100` : '—', delta:'', tone:'neutral',
      sub:'Across current HOT leads' },
  ];

  const signals = hot
    .slice()
    .sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0))
    .map((l) => {
      const nh = l.conversations?.[0]?.status === 'NEEDS_HUMAN';
      return {
        id: l.id,
        name: l.contact?.name || 'Unknown',
        conf: l.aiScore || 0,
        snippet: l.activities?.[0]?.content || 'No recent activity',
        action: nh
          ? 'AI flagged this conversation for human takeover — open and respond'
          : `Stage ${l.stage || '—'} — review qualification and push to the next step`,
        pillLabel: nh ? 'Needs human' : (l.stage || 'HOT'),
        pillCls: STAGE_PILLS[nh ? 'NEEDS_HUMAN' : l.stage] || 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        phone: l.contact?.phone,
      };
    });

  return (
    <>
      <InsightsHeader
        note={error ? '⚠ refresh failed' : `Live · ${hot.length} HOT leads`}
        onRefresh={load}
      />
      <div className="space-y-6 p-8">
        {error && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            ⚠ Couldn’t refresh — showing the last known data.
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => <KpiInsight key={k.label} {...k} />)}
        </section>

        <section>
          <SignalsFeed
            signals={signals}
            subtitle="Real HOT leads from your pipeline, sorted by AI score."
            emptyText="No HOT leads right now — signals appear here as the AI scores conversations."
            renderButtons={(s) => (
              <>
                <button
                  onClick={() => navigate('/leads')}
                  className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20"
                >
                  Open lead
                </button>
                {s.phone && (
                  <a
                    href={`https://wa.me/${s.phone.replace(/\D/g, '')}`}
                    target="_blank" rel="noreferrer"
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-center text-[11px] text-emerald-400 hover:bg-emerald-500/20"
                  >
                    WhatsApp
                  </a>
                )}
              </>
            )}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            {digest?.bullets?.length ? (
              <DigestBox bullets={digest.bullets} live />
            ) : (
              <CollectingCard title="Weekly Insights Digest"
                text="The digest builds itself from classified conversations. As new WhatsApp messages arrive, the AI tags each one and this panel fills in — check back after a day of traffic." />
            )}
          </div>
          <div className="lg:col-span-2">
            {sentiment?.sampleSize > 0 ? (
              <SentimentChart data={sentiment.trend} />
            ) : (
              <CollectingCard title="Sentiment (last 7 days)"
                text="Collecting data — every new inbound message is now classified positive / neutral / negative. The trend appears as messages come in." />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

// ───────────────────────────── Demo (DSP Bootcamp) ───────────
function DemoInsights() {
  const signals = DEMO_SIGNALS.map((s) => {
    const style = SIGNAL_STYLES[s.type] || SIGNAL_STYLES.PRICING;
    return { ...s, pillLabel: style.label, pillCls: style.pill };
  });
  return (
    <>
      <InsightsHeader note="Demo data · last 7 days" />
      <div className="space-y-6 p-8">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DEMO_KPI_INSIGHTS.map((k) => <KpiInsight key={k.label} {...k} />)}
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <SignalsFeed
            className="lg:col-span-3"
            signals={signals}
            subtitle="Top intent signals from the last 7 days. Sorted by AI confidence."
            renderButtons={(s) => (
              <>
                <button
                  onClick={() => alert(`Demo: would ${s.primary.toLowerCase()} for ${s.name}`)}
                  className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20"
                >
                  {s.primary}
                </button>
                <button
                  onClick={() => alert(`Demo: would dismiss signal for ${s.name}`)}
                  className="rounded-md border border-slate-700/60 bg-transparent px-2.5 py-1 text-[11px] text-slate-400 hover:bg-surface2/60"
                >
                  Dismiss
                </button>
              </>
            )}
          />
          <SentimentChart className="lg:col-span-2" data={DEMO_SENTIMENT_TREND} />
        </section>

        <section>
          <DigestBox bullets={DEMO_DIGEST_BULLETS} />
        </section>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared header
// ─────────────────────────────────────────────────────────────
function InsightsHeader({ note, onRefresh }) {
  return (
    <PageHeader
      title="AI Insights"
      subtitle="What the AI is seeing across your inbox — buying signals and recommended actions."
      action={
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 glow-green" />
            {note}
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500 hover:text-white"
            >
              ↺ Refresh
            </button>
          )}
        </div>
      }
    />
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
// Buying signals feed (shared by live + demo)
// ─────────────────────────────────────────────────────────────
function SignalsFeed({ className = '', signals, subtitle, renderButtons, emptyText }) {
  return (
    <div className={`glass-card rounded-xl ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-100">Buying Signals</h2>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
        <span className="text-xs text-slate-500">{signals.length} signals</span>
      </div>
      {signals.length === 0 ? (
        <div className="py-14 text-center text-sm text-slate-500">{emptyText || 'No signals yet.'}</div>
      ) : (
        <ul className="divide-y divide-slate-800/60">
          {signals.map((s) => <SignalRow key={s.id} signal={s} renderButtons={renderButtons} />)}
        </ul>
      )}
    </div>
  );
}

function SignalRow({ signal, renderButtons }) {
  return (
    <li className="px-5 py-3.5 transition-colors hover:bg-surface2/40">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-xs font-semibold text-slate-200">
          {initials(signal.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-100">{signal.name}</span>
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${signal.pillCls}`}>
              {signal.pillLabel}
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
          {renderButtons?.(signal)}
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
// Sentiment chart (demo mode only until the analysis pipeline ships)
// ─────────────────────────────────────────────────────────────
function SentimentChart({ className = '', data }) {
  return (
    <div className={`glass-card flex flex-col rounded-xl ${className}`}>
      <div className="border-b border-slate-800/60 px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">Sentiment (last 7 days)</h2>
        <p className="mt-0.5 text-xs text-slate-500">% of inbound messages classified positive / neutral / negative.</p>
      </div>
      <div className="flex-1 px-3 pb-4 pt-2" style={{ minHeight: 280 }}>
        <ResponsiveContainer width="100%" height="100%" minHeight={280}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} stackOffset="expand">
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
            <XAxis dataKey="day" stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={{ stroke:'#1e293b' }} />
            <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false}
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
// Weekly insights digest (demo mode only until the pipeline ships)
// ─────────────────────────────────────────────────────────────
function CollectingCard({ title, text }) {
  return (
    <div className="glass-card flex h-full flex-col rounded-xl px-5 py-5">
      <h2 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}

function DigestBox({ bullets, live = false }) {
  return (
    <div className="glass-card rounded-xl">
      <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-100">Weekly Insights Digest</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {live ? 'Built from your classified conversations — last 7 days.' : "Auto-generated every Monday 9 AM PKT. Here's what AI noticed last week."}
          </p>
        </div>
        {!live && (
          <button
            onClick={() => alert('Demo: would email digest to team')}
            className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20"
          >
            Email digest →
          </button>
        )}
      </div>
      <ul className="space-y-2.5 px-5 py-4">
        {bullets.map((b, i) => (
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
