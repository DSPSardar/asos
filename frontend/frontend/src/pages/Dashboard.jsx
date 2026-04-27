// src/pages/Dashboard.jsx

const { useState, useEffect } = React;

const Dashboard = () => {
  const { data: overview, loading } = useData('overview', '/analytics/overview');

  const revData   = MOCK.revenueTimeline;
  const aiData    = MOCK.aiPerformance;
  const revValues = revData.map(d => d.revenue);
  const revLabels = revData.map(d => d.date);
  const aiValues  = aiData.map(d => d.score);
  const aiLabels  = aiData.map(d => d.name);

  const kpis = [
    { label:'Total Leads',        value: overview?.leads?.total    || 1284, icon:'◉', color:'#6366f1', change:14.2 },
    { label:'Hot Leads',          value: overview?.leads?.hot      || 87,   icon:'🔥',color:'#ef4444', change:8.7  },
    { label:'Closed Won',         value: overview?.leads?.closedWon|| 142,  icon:'✓', color:'#10b981', change:22.1 },
    { label:'Revenue Influenced', value: overview?.revenue?.total  || 487600, prefix:'$', icon:'$', color:'#f59e0b', change:18.4 },
  ];

  return (
    <div className="p-6 space-y-6 page-enter">

      {/* KPI grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k, i) => <KPICard key={i} {...k} loading={loading} />)}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Revenue area */}
        <div className="xl:col-span-2 glass-card rounded-2xl p-5">
          <SectionHeader title="Revenue Timeline" subtitle="Monthly revenue from AI-closed deals"
                         action={<Badge label="PRO" color="PRO" />} />
          {loading
            ? <Skeleton className="h-48 w-full" />
            : <AreaChart data={revData.map((d,i)=>({revenue:d.revenue}))}
                         dataKey="revenue" color="#6366f1" height={200}
                         labels={revLabels} prefix="$" />
          }
        </div>

        {/* AI score bars */}
        <div className="glass-card rounded-2xl p-5">
          <SectionHeader title="AI Score / Day" subtitle="Avg lead score" />
          {loading
            ? <Skeleton className="h-48 w-full" />
            : <BarChartSVG data={aiData} dataKey="score" color="#8b5cf6"
                            height={200} labels={aiLabels} suffix="/10" />
          }
        </div>
      </div>

      {/* Stats + Funnel row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* AI Stats */}
        <div className="glass-card rounded-2xl p-5">
          <SectionHeader title="AI Engine Stats" subtitle="Current billing period" />
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (
            <div className="space-y-4">
              <StatRow label="AI Handled Messages" value="6,993"    color="#818cf8" />
              <StatRow label="AI Handling Rate"     value="78.4%"   color="#10b981" />
              <StatRow label="Conversion Rate"      value="11.1%"   color="#f59e0b" />
              <div className="space-y-2.5 pt-1">
                <ProgressBar label="AI Tokens Used" value={3420000} max={5000000} color="#6366f1" />
                <ProgressBar label="Messages Used"  value={8920}    max={50000}   color="#8b5cf6" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <PulseDot color="#10b981" />
                <span className="text-xs text-emerald-400 font-medium">Claude AI Online</span>
              </div>
            </div>
          )}
        </div>

        {/* Funnel */}
        <div className="xl:col-span-2 glass-card rounded-2xl p-5">
          <SectionHeader title="Sales Funnel" subtitle="Lead stage conversion" />
          <div className="space-y-2">
            {MOCK.funnelData.map((stage) => {
              const maxCount = MOCK.funnelData[0].count;
              const pct = (stage.count / maxCount) * 100;
              return (
                <div key={stage.stage} className="flex items-center gap-4">
                  <div className="w-24 text-xs text-slate-500 font-mono truncate">{stage.stage}</div>
                  <div className="flex-1 h-8 bg-slate-800/50 rounded-lg overflow-hidden relative">
                    <div className="h-full rounded-lg transition-all duration-1000 flex items-center px-3"
                         style={{ width:`${pct}%`,
                                  background:`linear-gradient(90deg,${stage.color}99,${stage.color}55)`,
                                  border:`1px solid ${stage.color}40` }}>
                      <span className="text-xs font-bold text-white/90 font-mono">{stage.count}</span>
                    </div>
                  </div>
                  {stage.rate && (
                    <div className="w-14 text-xs text-right text-slate-400 font-mono">{stage.rate}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* AI Summary panel */}
      <div className="glass-card rounded-2xl p-5"
           style={{ border:'1px solid rgba(99,102,241,0.2)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
               style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.3),rgba(139,92,246,0.2))' }}>◎</div>
          <div>
            <div className="text-sm font-bold text-indigo-300">AI Sales Intelligence</div>
            <div className="text-xs text-slate-500">Generated today · Powered by Claude</div>
          </div>
          <div className="ml-auto"><Badge label="AI" /></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-slate-400 leading-relaxed">
          {[
            { color:'rgba(99,102,241,0.06)', border:'rgba(99,102,241,0.1)', label:'🔥 Opportunity', labelColor:'#818cf8',
              text:'87 HOT leads identified. Top campaign "Eid ul-Fitr Sale" showing 5.68 ROAS — recommend 40% budget increase.' },
            { color:'rgba(245,158,11,0.06)',  border:'rgba(245,158,11,0.1)', label:'⚠ Attention',   labelColor:'#f59e0b',
              text:'23 leads stuck in PROPOSED stage > 3 days. AI can auto-send urgency message — enable in AI Settings.' },
            { color:'rgba(16,185,129,0.06)',  border:'rgba(16,185,129,0.1)', label:'✓ Win',         labelColor:'#10b981',
              text:'AI handling 78.4% of conversations autonomously. Conversion rate 11.1% — 3.2× industry average.' },
          ].map(({ color, border, label, labelColor, text }) => (
            <div key={label} className="p-3 rounded-xl"
                 style={{ background:color, border:`1px solid ${border}` }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2"
                   style={{ color:labelColor }}>{label}</div>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

window.DashboardPage = Dashboard;
