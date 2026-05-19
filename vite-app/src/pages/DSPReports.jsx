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

// ── Static mock data (derived from seed) ─────────────────────────────────────
const FUNNEL_DATA = [
  { name: 'New Leads',   value: 300, fill: COLORS.indigo  },
  { name: 'Contacted',   value: 240, fill: COLORS.violet  },
  { name: 'Interested',  value: 170, fill: COLORS.sky     },
  { name: 'Enrolled',    value: 90,  fill: COLORS.amber   },
  { name: 'Paid',        value: 40,  fill: COLORS.emerald },
];

const SOURCE_DATA = [
  { name: 'Facebook Ads', value: 35, color: COLORS.indigo  },
  { name: 'Instagram Ads',value: 25, color: COLORS.violet  },
  { name: 'WhatsApp',     value: 20, color: COLORS.emerald },
  { name: 'Referral',     value: 12, color: COLORS.amber   },
  { name: 'Organic',      value: 8,  color: COLORS.sky     },
];

const CITY_DATA = [
  { city: 'Karachi',    leads: 90,  enrolled: 12 },
  { city: 'Lahore',     leads: 75,  enrolled: 10 },
  { city: 'Islamabad',  leads: 60,  enrolled: 9  },
  { city: 'Rawalpindi', leads: 30,  enrolled: 4  },
  { city: 'Faisalabad', leads: 21,  enrolled: 3  },
  { city: 'Peshawar',   leads: 15,  enrolled: 1  },
  { city: 'Multan',     leads: 9,   enrolled: 1  },
];

const AGE_DATA = [
  { group: '18-24', count: 120, pct: 40 },
  { group: '25-30', count: 105, pct: 35 },
  { group: '31-35', count: 45,  pct: 15 },
  { group: '36+',   count: 30,  pct: 10 },
];

// Build 90-day revenue trend
const REVENUE_TREND = (() => {
  const days = [];
  let cum = 0;
  for (let i = 89; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400 * 1000);
    const label = d.toLocaleDateString('en-PK', { day:'2-digit', month:'short' });
    // 0-2 enrollments per day randomly seeded
    const daily = [0,0,0,1,1,0,0,0,1,0,0,0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0,0,1,0,
                   0,0,0,1,0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,1,0,0,0,
                   0,1,0,0,0,0,2,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,1,0,0,0,0,1,0][i] || 0;
    cum += daily * 10000;
    if (i % 7 === 0 || i === 0) days.push({ date: label, revenue: cum, enrollments: daily });
  }
  return days;
})();

const WEEKLY_ENROLL = [
  { week: 'Wk 1', enrollments: 2 },
  { week: 'Wk 2', enrollments: 4 },
  { week: 'Wk 3', enrollments: 3 },
  { week: 'Wk 4', enrollments: 5 },
  { week: 'Wk 5', enrollments: 4 },
  { week: 'Wk 6', enrollments: 6 },
  { week: 'Wk 7', enrollments: 4 },
  { week: 'Wk 8', enrollments: 7 },
  { week: 'Wk 9', enrollments: 5 },
  { week: 'Wk10', enrollments: 8 },
  { week: 'Wk11', enrollments: 6 },
  { week: 'Wk12', enrollments: 9 },
];

// ── KPI data ──────────────────────────────────────────────────────────────────
const KPI_DATA = [
  { label: 'Total Leads',      value: '300',           sub: '+12% vs last month', icon: '👥', color: 'indigo' },
  { label: 'Enrolled',         value: '40',            sub: '13.3% conversion',   icon: '🎓', color: 'violet' },
  { label: 'Revenue',          value: 'Rs. 4,00,000',  sub: '40 × Rs. 10,000',    icon: '💰', color: 'emerald'},
  { label: 'Active Students',  value: '40',            sub: 'Learn 24 · Build 10 · Earn 6', icon: '📚', color: 'sky' },
  { label: 'Cost per Lead',    value: 'Rs. 1,858',     sub: 'Blended all sources', icon: '📊', color: 'amber' },
  { label: 'ROI (paid ads)',   value: '242%',          sub: 'Spend Rs. 1.60L → Rev Rs. 4L', icon: '📈', color: 'rose' },
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

  useEffect(() => {
    const days = Number(period) || 90;
    const from = new Date(Date.now() - days * 86400000).toISOString();
    const to   = new Date().toISOString();

    setLoading(true);
    Promise.allSettled([
      analyticsAPI.overview({ from, to }),
      analyticsAPI.funnel({ from, to }),
      analyticsAPI.revenue({ from, to }),
    ]).then(([ovRes, fnRes, revRes]) => {

      // KPIs from overview
      if (ovRes.status === 'fulfilled') {
        const ov = ovRes.value.data?.data || ovRes.value.data;
        if (ov) {
          const total   = ov.leads?.total   || 0;
          const won     = ov.leads?.closedWon || 0;
          const convPct = total > 0 ? ((won / total) * 100).toFixed(1) + '%' : '0%';
          setKpiData([
            { label: 'Total Leads',     value: total.toLocaleString(),            sub: `${ov.leads?.hot||0} hot`,           icon: '👥', color: 'indigo'  },
            { label: 'Enrolled / Won',  value: won.toLocaleString(),              sub: `${convPct} conversion`,             icon: '🎓', color: 'violet'  },
            { label: 'Revenue',         value: fmtPKR(ov.revenue?.total || 0),   sub: `${won} bookings`,                   icon: '💰', color: 'emerald' },
            { label: 'Hot Leads',       value: (ov.leads?.hot||0).toLocaleString(), sub: 'ready to close',                  icon: '🔥', color: 'rose'    },
            { label: 'AI Handle Rate',  value: ov.messages?.aiHandlingRate||'0%', sub: 'no human takeover needed',          icon: '🤖', color: 'sky'     },
            { label: 'Messages Sent',   value: (ov.messages?.total||0).toLocaleString(), sub: `${ov.messages?.aiHandled||0} by AI`, icon: '💬', color: 'amber' },
          ]);
        }
      }

      // Enrollment funnel from API funnel
      if (fnRes.status === 'fulfilled') {
        const arr = fnRes.value.data?.data?.funnel || fnRes.value.data?.funnel || [];
        const STAGE_LABEL = { NEW:'New Leads', QUALIFYING:'Contacted', DIAGNOSED:'Interested', PROPOSED:'Proposed', CLOSED_WON:'Enrolled' };
        const STAGE_FILL  = { NEW: COLORS.indigo, QUALIFYING: COLORS.violet, DIAGNOSED: COLORS.sky, PROPOSED: COLORS.amber, CLOSED_WON: COLORS.emerald };
        const mapped = arr
          .filter(f => f.stage !== 'CLOSED_LOST')
          .map(f => ({ name: STAGE_LABEL[f.stage]||f.stage, value: f.count, fill: STAGE_FILL[f.stage]||COLORS.slate }));
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
                        {Math.round((item.value / FUNNEL_DATA[0].value) * 100)}%
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
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={SOURCE_DATA} cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={3} dataKey="value">
                    {SOURCE_DATA.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip prefix="" />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                {SOURCE_DATA.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                    <span className="text-slate-400 truncate">{s.name}</span>
                    <span className="ml-auto text-slate-200 font-semibold">{s.value}%</span>
                  </div>
                ))}
              </div>
            </div>
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

        {/* ── Row 3: City + Age ────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* City breakdown */}
          <div className="bg-surface/60 border border-slate-800/60 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">City-wise Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={CITY_DATA} layout="vertical" barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={CHART_STYLE} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="city" tick={CHART_STYLE} axisLine={false} tickLine={false} width={70} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="leads" fill={COLORS.indigo} name="Leads" radius={[0,4,4,0]} opacity={0.8} />
                <Bar dataKey="enrolled" fill={COLORS.emerald} name="Enrolled" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Age group split */}
          <div className="bg-surface/60 border border-slate-800/60 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">Age Group Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={AGE_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="group" tick={CHART_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={CHART_STYLE} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Leads" radius={[4,4,0,0]}>
                  {AGE_DATA.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-3 mt-2 flex-wrap">
              {AGE_DATA.map((a, i) => (
                <span key={i} className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span className="w-2 h-2 rounded-sm" style={{ background: PIE_COLORS[i] }} />
                  {a.group} ({a.pct}%)
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Row 4: Weekly enrollment + Source ROI ─────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Weekly enrollment */}
          <div className="bg-surface/60 border border-slate-800/60 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">Weekly Enrollments</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={WEEKLY_ENROLL}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="week" tick={CHART_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={CHART_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="enrollments" fill={COLORS.violet} radius={[4,4,0,0]} name="Enrollments" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Source ROI table */}
          <div className="bg-surface/60 border border-slate-800/60 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">ROI by Source</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800/60">
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 font-medium text-right">Leads</th>
                    <th className="pb-2 font-medium text-right">Enrolled</th>
                    <th className="pb-2 font-medium text-right">Revenue</th>
                    <th className="pb-2 font-medium text-right">CPL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {[
                    { source: 'Facebook Ads', leads: 105, enrolled: 14, spend: 98500  },
                    { source: 'Instagram Ads',leads: 75,  enrolled: 10, spend: 61200  },
                    { source: 'WhatsApp',     leads: 60,  enrolled: 9,  spend: 12000  },
                    { source: 'Referral',     leads: 36,  enrolled: 5,  spend: 0      },
                    { source: 'Organic',      leads: 24,  enrolled: 2,  spend: 0      },
                  ].map(r => (
                    <tr key={r.source} className="text-slate-300">
                      <td className="py-2 text-slate-400">{r.source}</td>
                      <td className="py-2 text-right">{r.leads}</td>
                      <td className="py-2 text-right text-emerald-400 font-medium">{r.enrolled}</td>
                      <td className="py-2 text-right">Rs.{(r.enrolled * 10000).toLocaleString()}</td>
                      <td className="py-2 text-right">{r.spend > 0 ? `Rs.${Math.round(r.spend/r.leads).toLocaleString()}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>{/* /p-6 */}
    </div>
  );
}
