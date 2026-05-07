// src/pages/Students.jsx — DSP Student Lifecycle (Learn → Build → Earn)
import { useState, useEffect, useCallback } from 'react';
import { leadsAPI } from '@lib/api';

// ── Phase config ──────────────────────────────────────────────────────────────
const PHASES = {
  LEARN: {
    label: 'Learn',
    color: 'indigo',
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/30',
    text: 'text-indigo-400',
    dot: 'bg-indigo-500',
    icon: '📚',
    desc: 'Foundation + Prompt Mastery (Week 1-2)',
    progress: 33,
  },
  BUILD: {
    label: 'Build',
    color: 'violet',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    text: 'text-violet-400',
    dot: 'bg-violet-500',
    icon: '🛠️',
    desc: 'Agent Building + Project (Week 3-4)',
    progress: 66,
  },
  EARN: {
    label: 'Earn',
    color: 'emerald',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    dot: 'bg-emerald-500',
    icon: '💰',
    desc: 'Client Work + Dollar Income',
    progress: 100,
  },
};

const PHASE_STEPS = {
  LEARN: [
    { label: 'Enrolled & payment confirmed', done: true },
    { label: 'Week 1 sessions attended', done: true },
    { label: 'Week 2 sessions attended', done: true },
    { label: 'Prompt mastery assessment', done: false },
    { label: 'SECP certificate issued', done: false },
  ],
  BUILD: [
    { label: 'Enrolled & payment confirmed', done: true },
    { label: 'All sessions completed', done: true },
    { label: 'SECP certificate issued', done: true },
    { label: 'First AI agent built', done: true },
    { label: 'Internship/project assigned', done: false },
    { label: 'Client project delivered', done: false },
  ],
  EARN: [
    { label: 'Enrolled & payment confirmed', done: true },
    { label: 'All sessions completed', done: true },
    { label: 'SECP certificate issued', done: true },
    { label: 'First AI agent built', done: true },
    { label: 'First client project delivered', done: true },
    { label: 'Earning in PKR/USD', done: true },
  ],
};

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtPKR  = (v) => `Rs. ${Number(v).toLocaleString('en-PK')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' }) : '—';

export default function Students() {
  const [students, setStudents]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [phase, setPhase]         = useState('ALL');
  const [selected, setSelected]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadsAPI.list({ stage: 'CLOSED_WON', limit: 200 });
      const raw = res?.data?.data ?? res?.data ?? [];
      setStudents(raw);
    } catch {
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = students.filter(s => {
    const name  = s.contact?.name || '';
    const city  = s.contact?.city || '';
    const matchSearch = !search || name.toLowerCase().includes(search.toLowerCase()) || city.toLowerCase().includes(search.toLowerCase());
    const matchPhase  = phase === 'ALL' || (s.dspPhase || 'LEARN') === phase;
    return matchSearch && matchPhase;
  });

  // ── Phase summary counts ──────────────────────────────────────────
  const phaseCounts = { LEARN: 0, BUILD: 0, EARN: 0 };
  students.forEach(s => { const p = s.dspPhase || 'LEARN'; if (phaseCounts[p] !== undefined) phaseCounts[p]++; });
  const totalRevenue = students.length * 10000;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-slate-800/60 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Student Lifecycle</h1>
            <p className="text-xs text-slate-400 mt-0.5">Track every student's journey — Learn → Build → Earn</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Total enrolled:</span>
            <span className="text-sm font-bold text-slate-100">{students.length}</span>
            <span className="ml-3 text-xs text-slate-400">Revenue:</span>
            <span className="text-sm font-bold text-emerald-400">{fmtPKR(totalRevenue)}</span>
          </div>
        </div>

        {/* Phase summary pills */}
        <div className="flex gap-3 mt-4 flex-wrap">
          {[['ALL', '📊', 'All Students', students.length, 'text-slate-300', 'bg-slate-700/50 border-slate-700'],
            ['LEARN', '📚', 'Learn Phase', phaseCounts.LEARN, 'text-indigo-400', 'bg-indigo-500/10 border-indigo-500/30'],
            ['BUILD', '🛠️', 'Build Phase', phaseCounts.BUILD, 'text-violet-400', 'bg-violet-500/10 border-violet-500/30'],
            ['EARN',  '💰', 'Earning',     phaseCounts.EARN,  'text-emerald-400','bg-emerald-500/10 border-emerald-500/30'],
          ].map(([key, icon, label, count, textCls, bgCls]) => (
            <button
              key={key}
              onClick={() => setPhase(key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${bgCls} ${textCls} ${phase === key ? 'ring-1 ring-current' : 'opacity-70 hover:opacity-100'}`}
            >
              <span>{icon}</span>
              <span>{label}</span>
              <span className="ml-0.5 font-bold">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-slate-800/40">
        <input
          type="text"
          placeholder="Search by name or city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60"
        />
      </div>

      {/* ── Grid / List ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Student cards */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-500 gap-2">
              <span className="text-3xl">🎓</span>
              <span className="text-sm">No students found</span>
              {students.length === 0 && <span className="text-xs">Run the DSP seed script first</span>}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map(s => (
                <StudentCard
                  key={s.id}
                  student={s}
                  onClick={() => setSelected(s)}
                  isSelected={selected?.id === s.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 border-l border-slate-800/60 overflow-y-auto flex-shrink-0">
            <StudentDetail student={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── StudentCard ───────────────────────────────────────────────────────────────
function StudentCard({ student, onClick, isSelected }) {
  const p    = student.dspPhase || 'LEARN';
  const cfg  = PHASES[p] || PHASES.LEARN;
  const name = student.contact?.name || 'Unknown';
  const city = student.contact?.city || '—';
  const age  = student.contact?.ageGroup || '—';
  const initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  const fmtDate2 = (d) => d ? new Date(d).toLocaleDateString('en-PK', { day:'2-digit', month:'short' }) : '—';

  return (
    <button
      onClick={onClick}
      className={`text-left w-full bg-surface/60 border rounded-xl p-4 transition-all hover:border-indigo-500/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 ${
        isSelected ? 'border-indigo-500/50 ring-1 ring-indigo-500/30' : 'border-slate-800/60'
      }`}
    >
      {/* Avatar + name */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-100 truncate">{name}</div>
          <div className="text-xs text-slate-400">{city} · {age}</div>
        </div>
      </div>

      {/* Phase badge */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold w-fit mb-3 ${cfg.bg} ${cfg.border} ${cfg.text}`}>
        <span>{cfg.icon}</span>
        <span>{cfg.label} Phase</span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-slate-700/50 rounded-full h-1.5 mb-2">
        <div
          className={`h-1.5 rounded-full transition-all ${cfg.dot}`}
          style={{ width: `${cfg.progress}%` }}
        />
      </div>

      {/* Meta */}
      <div className="flex justify-between text-xs text-slate-500 mt-1">
        <span>Enrolled {fmtDate2(student.closedAt)}</span>
        <span className="text-emerald-400 font-medium">Rs. 10,000</span>
      </div>
    </button>
  );
}

// ── StudentDetail ─────────────────────────────────────────────────────────────
function StudentDetail({ student, onClose }) {
  const p   = student.dspPhase || 'LEARN';
  const cfg = PHASES[p] || PHASES.LEARN;
  const steps = PHASE_STEPS[p] || PHASE_STEPS.LEARN;
  const name  = student.contact?.name || 'Unknown';
  const phone = student.contact?.phone || '—';
  const city  = student.contact?.city  || '—';
  const age   = student.contact?.ageGroup || '—';
  const qual  = student.qualificationData || {};
  const initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();

  return (
    <div className="p-5">
      {/* Close + header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-slate-100">Student Profile</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-lg leading-none">×</button>
      </div>

      {/* Avatar */}
      <div className="flex flex-col items-center text-center mb-5">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-lg font-bold text-white mb-2">
          {initials}
        </div>
        <div className="text-sm font-semibold text-slate-100">{name}</div>
        <div className="text-xs text-slate-400 mt-0.5">{city} · {age}</div>
        <div className="text-xs text-slate-500 mt-0.5">{phone}</div>
      </div>

      {/* Phase badge + progress */}
      <div className={`flex items-center justify-between px-3 py-2 rounded-lg border mb-4 ${cfg.bg} ${cfg.border}`}>
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${cfg.text}`}>
          <span>{cfg.icon}</span> {cfg.label} Phase
        </span>
        <span className={`text-xs font-bold ${cfg.text}`}>{cfg.progress}%</span>
      </div>
      <div className="w-full bg-slate-700/50 rounded-full h-2 mb-5">
        <div className={`h-2 rounded-full ${cfg.dot}`} style={{ width: `${cfg.progress}%` }} />
      </div>

      {/* Phase description */}
      <div className="text-xs text-slate-400 mb-4 px-1">{cfg.desc}</div>

      {/* Checklist */}
      <div className="mb-5">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Milestones</div>
        <div className="space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] ${
                step.done ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-400' : 'bg-slate-700/60 border border-slate-600/50 text-slate-500'
              }`}>
                {step.done ? '✓' : '○'}
              </div>
              <span className={`text-xs ${step.done ? 'text-slate-300' : 'text-slate-500'}`}>{step.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Info rows */}
      <div className="space-y-2 border-t border-slate-800/60 pt-4">
        {[
          ['Source', student.sourceUtm?.source?.replace(/_/g,' ') || '—'],
          ['Occupation', qual.occupation || '—'],
          ['Goal', qual.goal || '—'],
          ['Tech background', qual.techBackground || '—'],
          ['Enrolled', fmtDate(student.closedAt)],
          ['Enrollment fee', fmtPKR(10000)],
          ['AI Score', `${student.aiScore}/100`],
        ].map(([label, val]) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-slate-500">{label}</span>
            <span className="text-slate-300 capitalize">{val}</span>
          </div>
        ))}
      </div>

      {/* Phase progression buttons */}
      <div className="mt-5 space-y-2 border-t border-slate-800/60 pt-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Move Phase</div>
        {Object.entries(PHASES).map(([key, c]) => (
          <button
            key={key}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
              key === p
                ? `${c.bg} ${c.border} ${c.text} ring-1 ring-current`
                : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:border-slate-600 hover:text-slate-300'
            }`}
          >
            <span>{c.icon}</span> {c.label}
            {key === p && <span className="ml-auto text-[10px] opacity-60">current</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
