// src/pages/Analytics.jsx

const { useState } = React;

const Analytics = () => {
  const [period, setPeriod] = useState('12m');
  const revData  = MOCK.revenueTimeline;
  const perfData = MOCK.aiPerformance;
  const funnel   = MOCK.funnelData;

  const pieData  = [
    { name:'HOT',  value:87  },
    { name:'WARM', value:312 },
    { name:'COLD', value:885 },
  ];
  const PIE_COLORS = ['#ef4444','#f59e0b','#64748b'];

  return (
    <div className="p-6 space-y-6 page-enter">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Revenue · Funnel · AI performance · Lead quality</p>
        </div>
        <div className="flex items-center gap-1">
          {['7d','30d','3m','12m'].map(p => (
            <Button key={p} size="sm" variant={period===p ? 'primary' : 'ghost'}
                    onClick={() => setPeriod(p)}>{p}</Button>
          ))}
        </div>
      </div>

      {/* Row 1: Revenue area + Lead quality donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        <div className="xl:col-span-2 glass-card rounded-2xl p-5">
          <SectionHeader title="Revenue Timeline" subtitle="Monthly closed-won revenue" />
          <AreaChart
            data={revData}
            dataKey="revenue"
            color="#6366f1"
            height={220}
            labels={revData.map(d => d.date)}
            prefix="$"
          />
        </div>

        <div className="glass-card rounded-2xl p-5">
          <SectionHeader title="Lead Quality" subtitle="HOT / WARM / COLD split" />
          <div className="flex justify-center my-4">
            <DonutChart data={pieData} colors={PIE_COLORS} size={160} />
          </div>
          <div className="space-y-1.5 mt-2">
            {pieData.map((d, i) => (
              <ProgressBar key={d.name} value={d.value} max={1284}
                           color={PIE_COLORS[i]} label={`${d.name}: ${d.value}`} />
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Funnel bars + AI score */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        <div className="glass-card rounded-2xl p-5">
          <SectionHeader title="Conversion Funnel" subtitle="Leads by stage" />
          <div className="space-y-2 mt-2">
            {funnel.map((stage) => {
              const pct = (stage.count / funnel[0].count) * 100;
              return (
                <div key={stage.stage} className="flex items-center gap-3">
                  <div className="w-20 text-[10px] text-slate-500 font-mono">{stage.stage}</div>
                  <div className="flex-1 h-7 bg-slate-800/50 rounded-lg overflow-hidden">
                    <div className="h-full rounded-lg flex items-center px-3 transition-all duration-1000"
                         style={{ width:`${pct}%`,
                                  background:`linear-gradient(90deg,${stage.color}99,${stage.color}44)`,
                                  border:`1px solid ${stage.color}40` }}>
                      <span className="text-[11px] font-bold text-white/90 font-mono">{stage.count}</span>
                    </div>
                  </div>
                  <div className="w-12 text-[10px] text-right text-slate-500 font-mono">
                    {stage.rate || '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-5">
          <SectionHeader title="AI Score Trend" subtitle="Daily average lead score (7d)" />
          <AreaChart
            data={perfData}
            dataKey="score"
            color="#8b5cf6"
            height={200}
            labels={perfData.map(d => d.name)}
            suffix="/10"
          />
        </div>
      </div>

      {/* Row 3: Agent performance */}
      <div className="glass-card rounded-2xl p-5">
        <SectionHeader title="Agent Performance" subtitle="This period" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['Agent','Leads','Closed Won','Close Rate','Avg Deal Value'].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { name:'John Agent',   leads:84,   won:12,  rate:14.3, avg:'$9,400'  },
                { name:'Sarah Admin',  leads:67,   won:18,  rate:26.9, avg:'$7,800'  },
                { name:'Claude AI ◎', leads:1133, won:112, rate:9.9,  avg:'$6,200'  },
              ].map((a, i) => (
                <tr key={i} className="border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors">
                  <td className="py-3 px-3 font-medium text-slate-200">{a.name}</td>
                  <td className="py-3 px-3 font-mono text-slate-300">{a.leads}</td>
                  <td className="py-3 px-3 font-mono text-emerald-400">{a.won}</td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><ProgressBar value={a.rate} max={30} color="#6366f1" /></div>
                      <span className="font-mono text-slate-300 text-xs w-12 text-right">{a.rate}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-300">{a.avg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

window.AnalyticsPage = Analytics;
