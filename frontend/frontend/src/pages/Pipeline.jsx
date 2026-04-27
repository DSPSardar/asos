// src/pages/Pipeline.jsx — Kanban lead pipeline

const { useState } = React;

const STAGES = [
  { key:'NEW',        label:'New',        color:'#475569', accent:'rgba(71,85,105,0.2)'   },
  { key:'QUALIFYING', label:'Qualifying', color:'#6366f1', accent:'rgba(99,102,241,0.15)' },
  { key:'DIAGNOSED',  label:'Diagnosed',  color:'#8b5cf6', accent:'rgba(139,92,246,0.15)' },
  { key:'PROPOSED',   label:'Proposed',   color:'#f59e0b', accent:'rgba(245,158,11,0.15)' },
  { key:'CLOSED_WON', label:'Won ✓',      color:'#10b981', accent:'rgba(16,185,129,0.15)' },
];

const LeadCard = ({ lead, onClick }) => {
  const labelColors = { HOT:'#ef4444', WARM:'#f59e0b', COLD:'#64748b' };
  return (
    <div className="lead-card rounded-xl p-4 mb-2.5 animate-fade-in" onClick={() => onClick(lead)}>
      {/* v1.5 — HOT lead human-followup banner */}
      {lead.humanFollowupRequired && (
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider"
             style={{ background:'linear-gradient(135deg,rgba(244,63,94,0.18),rgba(251,146,60,0.12))', color:'#fb923c', border:'1px solid rgba(244,63,94,0.3)' }}>
          🔥 Human follow-up needed
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-200 mb-0.5">{lead.name}</div>
          <div className="text-xs text-slate-500 font-mono">{lead.phone}</div>
        </div>
        <ScoreRing score={lead.score} size={38} />
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Badge label={lead.label} />
        {lead.intent && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
                style={{ background:'rgba(99,102,241,0.12)', color:'#a5b4fc' }}>
            intent · {lead.intent}
          </span>
        )}
        {lead.value > 0 && (
          <span className="text-xs font-mono text-emerald-400 ml-auto">
            ${lead.value.toLocaleString('en-US')}
          </span>
        )}
      </div>

      {/* v1.5 — Qualifier problem summary */}
      {lead.problemSummary && (
        <div className="text-[11px] text-slate-400 leading-snug mb-2 line-clamp-2 italic">
          "{lead.problemSummary}"
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-slate-600">
        <span>{lead.campaign}</span>
        <span>{lead.created}</span>
      </div>
    </div>
  );
};

const Pipeline = () => {
  const { isLight, overlayBg, surfaceBg, borderColor } = useTheme();
  const { data, loading } = useData('leads', '/leads');
  const [selected, setSelected] = useState(null);
  const [filter, setFilter]     = useState('ALL');

  const leads = data || MOCK.leads;

  const byStage = (stageKey) =>
    leads.filter(l => l.stage === stageKey &&
      (filter === 'ALL' || l.label === filter));

  const totalValue = leads
    .filter(l => l.stage !== 'CLOSED_WON')
    .reduce((s, l) => s + (l.value || 0), 0);

  return (
    <div className="p-6 page-enter flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Lead Pipeline</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {leads.length} leads · Pipeline value{' '}
            <span className="text-emerald-400 font-mono">${totalValue.toLocaleString('en-US')}</span>
            {leads.filter(l => l.humanFollowupRequired).length > 0 && (
              <>
                {' · '}
                <span className="text-orange-400 font-mono">
                  🔥 {leads.filter(l => l.humanFollowupRequired).length} need human follow-up
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {['ALL','HOT','WARM','COLD'].map(f => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'primary' : 'ghost'}
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-4 flex-1 items-start">
        {STAGES.map(stage => {
          const stageleads = byStage(stage.key);
          return (
            <div key={stage.key} className="kanban-col rounded-2xl p-3 flex-shrink-0"
                 style={{ width: 220, minHeight: 400 }}>
              {/* Column header */}
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: stage.color, boxShadow:`0 0 6px ${stage.color}` }} />
                  <span className="text-xs font-bold text-slate-300">{stage.label}</span>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded-full font-bold"
                      style={{ background: stage.accent, color: stage.color }}>
                  {stageleads.length}
                </span>
              </div>

              {/* Cards */}
              {loading ? (
                [1,2].map(i => <Skeleton key={i} className="h-28 w-full mb-2.5 rounded-xl" />)
              ) : stageleads.length === 0 ? (
                <div className="text-center py-8 text-slate-700 text-xs">Empty</div>
              ) : (
                stageleads.map(lead => (
                  <LeadCard key={lead.id} lead={lead} onClick={setSelected} />
                ))
              )}
            </div>
          );
        })}
      </div>

      {/* Lead detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-end"
             onClick={() => setSelected(null)}>
          <div className="absolute inset-0" style={{ background: overlayBg, backdropFilter:'blur(4px)' }} />
          <div className="relative w-96 h-full glass-strong shadow-2xl p-6 overflow-y-auto animate-slide-in"
               onClick={e => e.stopPropagation()}>
            {/* Close */}
            <button className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 text-xl"
                    onClick={() => setSelected(null)}>×</button>

            {/* Lead header */}
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white"
                   style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                {selected.name[0]}
              </div>
              <div>
                <div className="font-bold text-slate-100">{selected.name}</div>
                <div className="text-xs text-slate-500 font-mono">{selected.phone}</div>
              </div>
              <div className="ml-auto"><ScoreRing score={selected.score} size={44} /></div>
            </div>

            <div className="flex gap-2 mb-6">
              <Badge label={selected.label} />
              <Badge label={selected.stage} />
              {selected.humanFollowupRequired && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md"
                      style={{ background:'linear-gradient(135deg,rgba(244,63,94,0.18),rgba(251,146,60,0.12))', color:'#fb923c', border:'1px solid rgba(244,63,94,0.3)' }}>
                  🔥 Human follow-up
                </span>
              )}
            </div>

            {/* v1.5 — Qualifier AI insight panel */}
            {(selected.problemSummary || selected.intent || selected.nextAction) && (
              <div className="mb-6 p-4 rounded-xl"
                   style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(34,211,238,0.04))', border:'1px solid rgba(99,102,241,0.18)' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color:'#a5b4fc' }}>
                  <span>◆</span> Qualifier AI
                </div>
                {selected.problemSummary && (
                  <div className="text-sm text-slate-200 mb-2 leading-snug">"{selected.problemSummary}"</div>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  {selected.intent && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider" style={{ background:'rgba(99,102,241,0.15)', color:'#a5b4fc' }}>intent · {selected.intent}</span>
                  )}
                  {selected.nextAction && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider" style={{ background:'rgba(34,211,238,0.12)', color:'#67e8f9' }}>next · {selected.nextAction}</span>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1 mb-6">
              <StatRow label="Campaign"     value={selected.campaign} />
              <StatRow label="Deal Value"   value={selected.value > 0 ? `$${selected.value.toLocaleString('en-US')}` : '—'} color="#10b981" />
              <StatRow label="Created"      value={selected.created} />
              <StatRow label="AI Score"     value={`${selected.score}/100`} color="#818cf8" />
            </div>

            {/* Qualification data */}
            <div className="mb-6">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">BANT Qualification</div>
              <div className="space-y-2">
                {[['Budget','Not confirmed'],['Authority','—'],['Need','Lead response speed'],['Timeline','This month']].map(([k,v])=>(
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-slate-300">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <Button className="w-full justify-center" variant="primary">
                💬 Open Conversation
              </Button>
              <Button className="w-full justify-center" variant="secondary">
                ✏ Edit Lead
              </Button>
              <Button className="w-full justify-center" variant="danger">
                Mark as Lost
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

window.PipelinePage = Pipeline;
