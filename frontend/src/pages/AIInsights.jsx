// src/pages/AIInsights.jsx — AI sales intelligence dashboard

const { useState } = React;

const ScoreGauge = ({ score }) => {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : 'Needs Work';
  const r = 64, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ * 0.75;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width:160, height:120 }}>
        <svg width="160" height="160" style={{ position:'absolute', top:0, left:0, transform:'rotate(135deg)' }}>
          <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(30,41,59,0.8)" strokeWidth="10"
                  strokeDasharray={`${circ * 0.75} ${circ}`} strokeLinecap="round" />
          <circle cx="80" cy="80" r={r} fill="none" stroke={color} strokeWidth="10"
                  strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                  style={{ filter:`drop-shadow(0 0 8px ${color})`, transition:'stroke-dasharray 1.5s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-6">
          <div className="text-4xl font-bold" style={{ color }}>{score}</div>
          <div className="text-xs text-slate-400 mt-1">{label}</div>
        </div>
      </div>
      <div className="text-sm text-slate-500 mt-1">Overall AI Score</div>
    </div>
  );
};

const WeakPointCard = ({ area, score, issue, fix, index }) => {
  const [open, setOpen] = useState(false);
  const scoreColor = score >= 80 ? '#10b981' : score >= 65 ? '#f59e0b' : '#ef4444';

  return (
    <div className="glass-card rounded-xl overflow-hidden animate-fade-in"
         style={{ animationDelay:`${index * 80}ms` }}>
      <div className="flex items-center gap-4 p-4 cursor-pointer" onClick={() => setOpen(!open)}>
        <div className="flex-shrink-0">
          <ScoreRing score={score} size={44} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-200 mb-1">{area}</div>
          <div className="text-xs text-slate-500 truncate">{issue}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ProgressBar value={score} max={100} color={scoreColor} />
          <span className="text-slate-500 text-lg">{open ? '↑' : '↓'}</span>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-slate-800/50 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
            <div className="p-3 rounded-xl" style={{ background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.1)' }}>
              <div className="text-xs font-semibold text-red-400 mb-1.5">⚠ Issue Detected</div>
              <p className="text-xs text-slate-400 leading-relaxed">{issue}</p>
            </div>
            <div className="p-3 rounded-xl" style={{ background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.1)' }}>
              <div className="text-xs font-semibold text-emerald-400 mb-1.5">✓ Recommended Fix</div>
              <p className="text-xs text-slate-400 leading-relaxed">{fix}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AIInsights = () => {
  const insights = MOCK.aiInsights;

  const radarData = [
    { subject:'Speed',      score:62 },
    { subject:'Qualify',    score:71 },
    { subject:'Closing',    score:68 },
    { subject:'Targeting',  score:81 },
    { subject:'Retention',  score:76 },
    { subject:'Follow-up',  score:59 },
  ];

  return (
    <div className="p-6 space-y-6 page-enter">

      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
             style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.3),rgba(139,92,246,0.2))' }}>◎</div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">AI Sales Intelligence</h1>
          <p className="text-sm text-slate-500">Claude-powered analysis · Updated {new Date().toLocaleDateString('en-US')}</p>
        </div>
        <div className="ml-auto"><Badge label="AI" /></div>
      </div>

      {/* Score + Radar row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Overall score gauge */}
        <div className="glass-card rounded-2xl p-6 flex flex-col items-center justify-center">
          <ScoreGauge score={insights.overallScore} />
          <div className="mt-4 w-full space-y-2">
            <StatRow label="Forecast (This Month)"  value={`$${insights.forecast.thisMonth.toLocaleString('en-US')}`} color="#10b981" />
            <StatRow label="Forecast (Next Month)"  value={`$${insights.forecast.nextMonth.toLocaleString('en-US')}`} color="#818cf8" />
            <StatRow label="AI Confidence"          value={insights.forecast.confidence} />
          </div>
        </div>

        {/* Radar chart */}
        <div className="glass-card rounded-2xl p-5">
          <SectionHeader title="Performance Radar" subtitle="AI analysis by dimension" />
          <div className="flex justify-center">
            <RadarChartSVG data={radarData} color="#6366f1" size={200} />
          </div>
        </div>

        {/* Opportunities */}
        <div className="glass-card rounded-2xl p-5">
          <SectionHeader title="Opportunities" subtitle="AI-detected growth levers" />
          <div className="space-y-2.5">
            {insights.opportunities.map((opp, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl animate-fade-in"
                   style={{ animationDelay:`${i*80}ms`, background:'rgba(99,102,241,0.05)', border:'1px solid rgba(99,102,241,0.1)' }}>
                <span className="text-indigo-400 mt-0.5 flex-shrink-0">▸</span>
                <p className="text-xs text-slate-400 leading-relaxed">{opp}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Weak points */}
      <div>
        <SectionHeader
          title="Weak Points Analysis"
          subtitle="Areas requiring attention — click to expand fix"
          action={
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <PulseDot color="#6366f1" />
              <span>AI analyzing your pipeline</span>
            </div>
          }
        />
        <div className="space-y-3">
          {insights.weakPoints.map((wp, i) => (
            <WeakPointCard key={wp.area} {...wp} index={i} />
          ))}
        </div>
      </div>

      {/* AI Recommendation block */}
      <div className="rounded-2xl p-6 relative overflow-hidden"
           style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.08))', border:'1px solid rgba(99,102,241,0.2)' }}>
        <div className="absolute top-0 right-0 text-[120px] opacity-5 leading-none select-none pointer-events-none">◎</div>
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
               style={{ background:'rgba(99,102,241,0.2)' }}>◎</div>
          <div>
            <div className="text-sm font-bold text-indigo-300 mb-1">Claude AI Recommendation</div>
            <p className="text-sm text-slate-400 leading-relaxed max-w-2xl">
              Your AI engine is performing at <strong className="text-indigo-400">74/100</strong>. The three highest-impact actions are:
              (1) Enable 24/7 AI automation to capture evening leads, (2) reorder BANT qualification to surface budget at message #3,
              and (3) activate automatic urgency triggers for HOT leads stuck 48h+ in PROPOSED. Implementing these three changes
              is projected to increase monthly revenue by <strong className="text-emerald-400">$18,600</strong>.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
};

window.AIInsightsPage = AIInsights;
