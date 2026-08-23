// src/pages/DSPReports.jsx — DSP Analytics & Reports
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { leadsAPI, analyticsAPI, campaignsAPI } from '@lib/api';

// ── Palette ───────────────────────────────────────────────────────────────────
const COLORS = {
  indigo:  '#6366f1',
  violet:  '#8b5cf6',
  emerald: '#10b981',
  amber:   '#f59e0b',
  rose:    '#f43f5e',
  sky:     '#0ea5e9',
  slate:   '#64748b',
};
const PIE_COLORS = [COLORS.indigo, COLORS.violet, COLORS.emerald, COLORS.amber, COLORS.sky];

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtPKR  = (v) => `Rs. ${Number(v).toLocaleString('en-PK')}`;
const fmtK    = (v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v;

// ── Empty-state defaults ─────────────────────────────────────────────────────
// These start empty and are filled from the API. They are deliberately NOT
// seeded with plausible-looking numbers: this page is meant to be shown to
// other people, and a chart that silently falls back to invented data is worse
// than one that says it has none.
const FUNNEL_DATA = [];

const REVENUE_TREND = [];

const KPI_DATA = [
  { label: 'Total Leads',      value: '—', sub: 'loading…', icon: '👥', color: 'indigo' },
  { label: 'Enrolled',         value: '—', sub: 'loading…', icon: '🎓', color: 'violet' },
  { label: 'Revenue',          value: '—', sub: 'loading…', icon: '💰', color: 'emerald'},
  { label: 'Hot Leads',        value: '—', sub: 'loading…', icon: '🔥', color: 'rose' },
  { label: 'AI Handle Rate',   value: '—', sub: 'loading…', icon: '🤖', color: 'sky' },
  { label: 'Messages Sent',    value: '—', sub: 'loading…', icon: '💬', color: 'amber' },
];

// ── Custom tooltip ────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label, prefix='' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      {label && <div className="text-slate-400 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span style={{ color: p.color || p.fill }} className="font-bold">●</span>
          <span className="text-slate-300">{p.name || p.dataKey}:</span>
          <span className="text-white font-semibold">{prefix}{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
};

const CHART_STYLE = { fontFamily: 'inherit', fontSize: 11, fill: '#94a3b8' };

// ── Main component ────────────────────────────────────────────────────────────
export default function DSPReports() {
  const [period,      setPeriod]    = useState('90');
  const [exporting,   setExporting] = useState(false);
  const [loading,     setLoading]   = useState(true);
  const [kpiData,     setKpiData]   = useState(KPI_DATA);
  const [funnelData,  setFunnelData]  = useState(FUNNEL_DATA);
  const [revTrend,    setRevTrend]    = useState(REVENUE_TREND);
  const [sourceData,  setSourceData]  = useState([]);
  const [convData,    setConvData]    = useState([]);

  useEffect(() => {
    const days = Number(period) || 90;
    const from = new Date(Date.now() - days * 86400000).toISOString();
    const to   = new Date().toISOString();

    setLoading(true);
    Promise.allSettled([
      analyticsAPI.overview({ from, to }),
      analyticsAPI.funnel({ from, to }),
      analyticsAPI.revenue({ from, to }),
      analyticsAPI.sources({ from, to }),
      analyticsAPI.conversions({ from, to }),
    ]).then(([ovRes, fnRes, revRes, srcRes, convRes]) => {

      // KPIs from overview
      if (ovRes.status === 'fulfilled') {
        const ov = ovRes.value.data?.data || ovRes.value.data;
        if (ov) {
          const total   = ov.leads?.total   || 0;
          const won     = ov.leads?.closedWon || 0;
          // Enrolled = fee recorded. Falls back to won only if the API predates
          // the split, so an older backend doesn't blank the KPI.
          const enrolled = ov.leads?.enrolled ?? won;
          const convPct = total > 0 ? ((enrolled / total) * 100).toFixed(1) + '%' : '0%';
          setKpiData([
            { label: 'Total Leads',     value: total.toLocaleString(),            sub: `${ov.leads?.hot||0} hot`,           icon: '👥', color: 'indigo'  },
            { label: 'Enrolled',        value: enrolled.toLocaleString(),         sub: `${convPct} conversion`,             icon: '🎓', color: 'violet'  },
            { label: 'Revenue',         value: fmtPKR(ov.revenue?.total || 0),   sub: `${enrolled} enrolled`,              icon: '💰', color: 'emerald' },
            { label: 'Hot Leads',       value: (ov.leads?.hot||0).toLocaleString(), sub: 'ready to close',                  icon: '🔥', color: 'rose'    },
            { label: 'AI Handle Rate',  value: ov.messages?.aiHandlingRate||'0%', sub: 'no human takeover needed',          icon: '🤖', color: 'sky'     },
            { label: 'Messages Sent',   value: (ov.messages?.total||0).toLocaleString(), sub: `${ov.messages?.aiHandled||0} by AI`, icon: '💬', color: 'amber' },
          ]);
        }
      }

      // Enrollment funnel from API funnel
      if (fnRes.status === 'fulfilled') {
        const arr = fnRes.value.data?.data?.funnel || fnRes.value.data?.funnel || [];
        const enrolledCount = fnRes.value.data?.data?.enrolled ?? fnRes.value.data?.enrolled ?? null;
        // CLOSED_WON is "Won", not "Enrolled" — the AI closes conversations won
        // on its own, so that bucket includes deals with no fee behind them.
        // Enrolled is appended as its own final step when the API reports it.
        const STAGE_LABEL = { NEW:'New Leads', QUALIFYING:'Contacted', DIAGNOSED:'Interested', PROPOSED:'Proposed', CLOSED_WON:'Won' };
        const STAGE_FILL  = { NEW: COLORS.indigo, QUALIFYING: COLORS.violet, DIAGNOSED: COLORS.sky, PROPOSED: COLORS.amber, CLOSED_WON: COLORS.emerald };
        const mapped = arr
          .filter(f => f.stage !== 'CLOSED_LOST')
          .map(f => ({ name: STAGE_LABEL[f.stage]||f.stage, value: f.count, fill: STAGE_FILL[f.stage]||COLORS.slate }));
        if (enrolledCount !== null) {
          mapped.push({ name: 'Enrolled', value: enrolledCount, fill: COLORS.emerald });
        }
        if (mapped.some(f => f.value > 0)) setFunnelData(mapped);
      }

      // Revenue trend
      if (revRes.status === 'fulfilled') {
        const timeline = revRes.value.data?.data?.timeline || revRes.value.data?.timeline || [];
        if (timeline.length > 0) {
          let cum = 0;
          const trend = timeline.map(r => {
            cum += Number(r.revenue) || 0;
            return { date: (r.date||'').slice(5) || r.date, revenue: cum, enrollments: 0 };
          });
          setRevTrend(trend);
        }
      }

      // Lead sources — real campaign attribution from /analytics/sources.
      // Leads with no campaign are reported as 'Direct / Organic' by the API
      // rather than being guessed into an ad channel.
      if (srcRes?.status === 'fulfilled') {
        const list = srcRes.value.data?.data?.sources || srcRes.value.data?.sources || [];
        setSourceData(list.map((s, i) => ({
          name: s.name,
          value: s.value,
          count: s.count,
          color: PIE_COLORS[i % PIE_COLORS.length],
        })));
      }

      // Enrollments over time — real daily conversions.
      if (convRes?.status === 'fulfilled') {
        const list = convRes.value.data?.data?.conversions || convRes.value.data?.conversions || [];
        setConvData(list.map(c => ({ date: (c.date || '').slice(5) || c.date, count: c.count })));
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [period]);

  const handleExport = () => {
    setExporting(true);
    setTimeout(() => {
      const rows = [
        ['Metric','Value'],
        ...kpiData.map(k => [k.label, k.value]),
      ];
      const csv  = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `dsp_report_${period}d.csv`; a.click();
      URL.revokeObjectURL(url);
      setExporting(false);
    }, 600);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-slate-800/60 px-6 py-4 flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Reports & Analytics</h1>
          <p className="text-xs text-slate-400 mt-0.5">DSP — Digital Skills Platform · PKR</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex bg-slate-800/60 border border-slate-700/60 rounded-lg overflow-hidden">
            {[['30','30d'],['60','60d'],['90','90d']].map(([v,l]) => (
              <button
                key={v}
                onClick={() => setPeriod(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-all ${period === v ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/60 border border-slate-600/60 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-500 transition-all"
          >
            {exporting ? (
              <span className="w-3 h-3 border border-slate-400/40 border-t-slate-300 rounded-full animate-spin" />
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            )}
            Export CSV
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500 animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-ping" />
            Loading live data…
          </div>
        )}
        {/* ── KPI Cards ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpiData.map(k => (
            <div key={k.label} className="bg-surface/60 border border-slate-800/60 rounded-xl p-4">
              <div className="text-xl mb-2">{k.icon}</div>
              <div className="text-lg font-bold text-slate-100 leading-tight">{k.value}</div>
              <div className="text-xs text-slate-400 mt-1">{k.label}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Row 1: Funnel + Source ───────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Enrollment funnel */}
          <div className="bg-surface/60 border border-slate-800/60 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">Enrollment Funnel</h3>
            <div className="space-y-2">
              {funnelData.map((item, i) => (
                <div key={item.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">{item.name}</span>
                    <span className="text-slate-200 font-medium">{item.value}</span>
                  </div>
                  <div className="h-6 bg-slate-800/60 rounded-md overflow-hidden">
                    <div
                      className="h-full rounded-md flex items-center pl-2 transition-all"
                      style={{
                        width: `${(item.value / Math.max(1, funnelData[0]?.value || 1)) * 100}%`,
                        background: item.fill,
                        opacity: 0.85 - i * 0.05,
                      }}
                    >
                      <span className="text-[10px] text-white font-semibold">
                        {funnelData[0]?.value ? Math.round((item.value / funnelData[0].value) * 100) : 0}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Lead source donut */}
          <div className="bg-surface/60 border border-slate-800/60 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">Lead Sources</h3>
            {sourceData.length === 0 ? (
              <div className="flex h-[140px] items-center justify-center text-center">
                <p className="text-xs text-slate-500">
                  No campaign attribution yet.<br />
                  Sources appear once leads arrive via a tracked campaign.
                </p>
              </div>
            ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={sourceData} cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={3} dataKey="value">
                    {sourceData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip prefix="" />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                {sourceData.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                    <span className="text-slate-400 truncate">{s.name}</span>
                    <span className="ml-auto text-slate-200 font-semibold">{s.value}%</span>
                  </div>
                ))}
              </div>
            </div>
            )}
          </div>
        </div>

        {/* ── Row 2: Revenue trend ─────────────────────────────────── */}
        <div className="bg-surface/60 border border-slate-800/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">Revenue Trend (Last {period} days)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={revTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={CHART_STYLE} axisLine={false} tickLine={false} />
              <YAxis tick={CHART_STYLE} axisLine={false} tickLine={false} tickFormatter={v => `Rs.${fmtK(v)}`} />
              <Tooltip content={<CustomTooltip prefix="Rs. " />} />
              <Line type="monotone" dataKey="revenue" stroke={COLORS.emerald} strokeWidth={2} dot={false} name="Cumulative Revenue" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* ── Row 3: Enrollments over time ──────────────────────────── */}
        {/* City and age charts were removed, not rewired: contacts carry no age
            field at all and city is empty for every contact (0 of 888), so any
            such chart could only ever show invented numbers. They belong back
            here once that data is actually captured. The old "ROI by Source"
            table was likewise hardcoded — including a revenue column computed
            as enrolled x 10000 — and is replaced by the real conversions
            series below. */}
        <div className="bg-surface/60 border border-slate-800/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">Enrollments Over Time</h3>
          {convData.length === 0 ? (
            <div className="flex h-[180px] items-center justify-center text-center">
              <p className="text-xs text-slate-500">
                No enrollments recorded in this period.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={convData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={CHART_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={CHART_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill={COLORS.violet} radius={[4,4,0,0]} name="Enrollments" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>{/* /p-6 */}
    </div>
  );
}
