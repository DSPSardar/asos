// src/pages/Dashboard.jsx — Landing page after login. KPI tiles + recent activity.
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { PageHeader } from '@pages/Layout';

// ── Mock data (replace with real API calls in a later pass) ──
const KPIS = [
  {
    label:    'Total Leads',
    value:    '247',
    delta:    '+12%',
    deltaTone:'up',
    subtitle: 'vs last week',
  },
  {
    label:    'Messages Today',
    value:    '184',
    delta:    'AI 92%',
    deltaTone:'neutral',
    subtitle: 'AI handled automatically',
  },
  {
    label:    'Conversion Rate',
    value:    '18.4%',
    delta:    '+2.1pp',
    deltaTone:'up',
    subtitle: 'lead → paying customer',
  },
  {
    label:    'AI Cost This Month',
    value:    '$42.18',
    delta:    '21%',
    deltaTone:'neutral',
    subtitle: 'of $200 budget',
  },
];

const RECENT_THREADS = [
  { id:'t1', name:'Ahmed Khan',     phone:'+92 333 4421872', preview:'1 unit means kya? 100 sft? Itna chota?',                            when:'2m',  handler:'AI'    },
  { id:'t2', name:'Ayesha Malik',   phone:'+92 321 9870034', preview:'PSX listing 3 saal mein? Pehle exit ka option hai?',                when:'18m', handler:'AI'    },
  { id:'t3', name:'Hassan Raza',    phone:'+92 300 7654129', preview:'4 cr ke shop units + sharing basis ke terms confirm karwa dein.',  when:'47m', handler:'Human' },
  { id:'t4', name:'Fatima Sheikh',  phone:'+92 345 9001775', preview:'RDA aur CDC approval ke documents ka wait karti hoon.',             when:'1h',  handler:'Human' },
  { id:'t5', name:'Bilal Ahmed',    phone:'+92 312 8866442', preview:'Studio vs 1-bed vs fractional — return same hai ya different?',    when:'2h',  handler:'AI'    },
];

const PIPELINE = [
  { stage:'New',      count:47, color:'#6366f1' },
  { stage:'Qual.',    count:32, color:'#8b5cf6' },
  { stage:'Diag.',    count:18, color:'#a855f7' },
  { stage:'Proposal', count: 9, color:'#d946ef' },
  { stage:'Won',      count:11, color:'#10b981' },
  { stage:'Lost',     count: 6, color:'#475569' },
];

export default function Dashboard() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Live snapshot of your AI sales pipeline."
        action={
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 glow-green" />
            Real-time · updated just now
          </div>
        }
      />

      <div className="space-y-6 p-8">
        {/* KPI tiles */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {KPIS.map((k) => <KpiTile key={k.label} {...k} />)}
        </section>

        {/* Two-column section */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <RecentConversations className="lg:col-span-3" />
          <PipelineSnapshot    className="lg:col-span-2" />
        </section>
      </div>
    </>
  );
}

// ── KPI tile ──────────────────────────────────────────────
function KpiTile({ label, value, delta, deltaTone, subtitle }) {
  const tone =
    deltaTone === 'up'   ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
    deltaTone === 'down' ? 'text-red-400 bg-red-400/10 border-red-400/20'             :
                           'text-slate-400 bg-slate-400/10 border-slate-400/20';
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        {delta && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
            {delta}
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
    </div>
  );
}

// ── Recent conversations ──────────────────────────────────
function RecentConversations({ className = '' }) {
  return (
    <div className={`glass-card rounded-xl ${className}`}>
      <SectionHeader title="Recent Conversations" hint="Last 5 threads" cta="View all →" ctaHref="/conversations" />
      <ul className="divide-y divide-slate-800/60">
        {RECENT_THREADS.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface2/40">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-xs font-semibold text-slate-200">
              {initials(t.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-100">{t.name}</span>
                <span className="hidden text-[10px] text-slate-600 sm:inline">{t.phone}</span>
              </div>
              <div className="truncate text-xs text-slate-400">{t.preview}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span className="text-[10px] tabular-nums text-slate-500">{t.when}</span>
              <Badge handler={t.handler} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Badge({ handler }) {
  const isAI = handler === 'AI';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
        isAI
          ? 'border-accent/30 bg-accent/10 text-accent'
          : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
      }`}
    >
      <span className={`inline-block h-1 w-1 rounded-full ${isAI ? 'bg-accent' : 'bg-amber-300'}`} />
      {handler}
    </span>
  );
}

// ── Pipeline snapshot (recharts) ──────────────────────────
function PipelineSnapshot({ className = '' }) {
  const total = PIPELINE.reduce((s, p) => s + p.count, 0);
  return (
    <div className={`glass-card rounded-xl ${className}`}>
      <SectionHeader
        title="Pipeline Snapshot"
        hint={`${total} active`}
        cta="Open leads →"
        ctaHref="/leads"
      />
      <div className="h-56 px-3 pb-4 pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={PIPELINE} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="22%">
            <XAxis
              dataKey="stage"
              stroke="#475569"
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#1e293b' }}
            />
            <YAxis
              stroke="#475569"
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip
              cursor={{ fill: 'rgba(99,102,241,0.06)' }}
              contentStyle={{
                background: 'rgba(15,23,42,0.95)',
                border: '1px solid rgba(99,102,241,0.25)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#94a3b8' }}
              itemStyle={{ color: '#f1f5f9' }}
              formatter={(v) => [`${v} leads`, '']}
              separator=""
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {PIPELINE.map((p, i) => <Cell key={i} fill={p.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-3 gap-2 border-t border-slate-800/60 px-5 py-3">
        {PIPELINE.map((p) => (
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

// ── Shared section header ─────────────────────────────────
function SectionHeader({ title, hint, cta, ctaHref }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h2>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {cta && (
        <a href={ctaHref} className="text-xs text-slate-500 transition-colors hover:text-accent">
          {cta}
        </a>
      )}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────
function initials(name = '') {
  return name.split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
}
