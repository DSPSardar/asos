// src/pages/AdsPerformance.jsx

const { useState } = React;

const CampaignCard = ({ camp, index }) => {
  const roasColor = camp.roas >= 6 ? '#10b981' : camp.roas >= 4 ? '#f59e0b' : '#ef4444';
  const statusColor = camp.status === 'ACTIVE' ? '#10b981' : '#f59e0b';

  return (
    <div className="glass-card rounded-2xl p-5 animate-fade-in"
         style={{ animationDelay:`${index*80}ms` }}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-sm font-bold text-slate-200 mb-1">{camp.name}</div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full"
                 style={{ background:statusColor, boxShadow:`0 0 6px ${statusColor}` }} />
            <span className="text-xs font-medium" style={{ color:statusColor }}>{camp.status}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold font-mono" style={{ color:roasColor }}>{camp.roas}x</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">ROAS</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { l:'Spend',       v:`R$${(camp.spend/1000).toFixed(1)}k`, c:'#94a3b8' },
          { l:'Revenue',     v:`R$${(camp.revenue/1000).toFixed(1)}k`, c:'#10b981' },
          { l:'Leads',       v:camp.leads, c:'#818cf8' },
          { l:'CPL',         v:`R$${camp.cpl}`, c:'#f59e0b' },
          { l:'Impressions', v:`${(camp.impressions/1000).toFixed(0)}k`, c:'#64748b' },
          { l:'CTR',         v:camp.ctr, c:'#06b6d4' },
        ].map(({ l, v, c }) => (
          <div key={l} className="p-2 rounded-xl"
               style={{ background:'rgba(30,41,59,0.5)', border:'1px solid rgba(51,65,85,0.4)' }}>
            <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{l}</div>
            <div className="text-xs font-bold font-mono" style={{ color:c }}>{v}</div>
          </div>
        ))}
      </div>

      <ProgressBar value={camp.revenue} max={camp.spend * 10} color={roasColor} label="Revenue vs Spend×10" />
    </div>
  );
};

const AdsPerformance = () => {
  const { data: campaigns, loading } = useData('campaigns', '/campaigns');
  const campData  = campaigns || MOCK.campaigns;
  const spendData = MOCK.adsSpend;

  const totals = campData.reduce((acc, c) => ({
    spend:   acc.spend   + c.spend,
    revenue: acc.revenue + c.revenue,
    leads:   acc.leads   + c.leads,
  }), { spend:0, revenue:0, leads:0 });

  const avgRoas = (totals.revenue / totals.spend).toFixed(2);

  return (
    <div className="p-6 space-y-6 page-enter">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Ads Performance</h1>
          <p className="text-sm text-slate-500 mt-0.5">Meta Ads attribution · Real-time campaign data</p>
        </div>
        <div className="flex items-center gap-2">
          <PulseDot color="#1877f2" />
          <span className="text-xs text-blue-400 font-medium">Meta Connected</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KPICard label="Total Spend"   value={totals.spend}            prefix="$" color="#ef4444" icon="💸" loading={loading} />
        <KPICard label="Total Revenue" value={totals.revenue}          prefix="$" color="#10b981" icon="💰" loading={loading} change={18.4} />
        <KPICard label="Avg ROAS"      value={parseFloat(avgRoas)}     suffix="x"   color="#f59e0b" icon="📈" loading={loading} />
        <KPICard label="Total Leads"   value={totals.leads}                         color="#818cf8" icon="👥" loading={loading} change={12.1} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        <div className="glass-card rounded-2xl p-5">
          <SectionHeader title="Daily Spend" subtitle="This week" />
          <BarChartSVG
            data={spendData}
            dataKey="spend"
            color="#ef4444"
            height={200}
            labels={spendData.map(d => d.date)}
            prefix="$"
          />
        </div>

        <div className="glass-card rounded-2xl p-5">
          <SectionHeader title="Daily Revenue" subtitle="This week" />
          <AreaChart
            data={spendData}
            dataKey="revenue"
            color="#10b981"
            height={200}
            labels={spendData.map(d => d.date)}
            prefix="$"
          />
        </div>
      </div>

      {/* Campaign cards */}
      <div>
        <SectionHeader
          title="Campaign Breakdown"
          subtitle={`${campData.filter(c=>c.status==='ACTIVE').length} active campaigns`}
          action={<Button size="sm" variant="secondary">+ New Campaign</Button>}
        />
        {loading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-56 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {campData.map((camp, i) => <CampaignCard key={camp.id} camp={camp} index={i} />)}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 p-4 rounded-xl text-xs text-slate-500"
           style={{ background:'rgba(24,119,242,0.06)', border:'1px solid rgba(24,119,242,0.15)' }}>
        <span className="text-blue-400 text-base">ℹ</span>
        <span>Attribution via <strong className="text-blue-400">Meta Conversions API (CAPI)</strong> — server-side events fire on Lead, CompleteRegistration, and Purchase stages.</span>
      </div>
    </div>
  );
};

window.AdsPerformancePage = AdsPerformance;
