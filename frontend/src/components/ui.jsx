// src/components/ui.jsx — Shared UI primitives

const { useState, useEffect } = React;

// ── Card ──────────────────────────────────────────────────────────────
const Card = ({ children, className = '', glow = false, onClick }) => (
  <div
    className={`glass-card rounded-2xl p-5 ${glow ? 'glow-sm' : ''} ${className}`}
    onClick={onClick}
    style={onClick ? { cursor: 'pointer' } : {}}
  >
    {children}
  </div>
);

// ── KPI Card with animated counter ───────────────────────────────────
const KPICard = ({ label, value, prefix = '', suffix = '', change, changeLabel, color = '#6366f1', icon, loading }) => {
  const numericValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, '')) || 0;
  const count = useCounter(loading ? 0 : numericValue);
  const isPositive = change > 0;

  const formatNum = (n) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000)    return `${(n / 1000).toFixed(1)}k`;
    return n.toLocaleString('en-US');
  };

  return (
    <div className="glass-card rounded-2xl p-5 animate-fade-in relative overflow-hidden">
      {/* Background glow orb */}
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 blur-2xl"
           style={{ background: color }} />

      <div className="flex items-start justify-between mb-4">
        <div className="text-xs font-medium text-slate-400 uppercase tracking-widest">{label}</div>
        {icon && (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
               style={{ background: `${color}20`, color }}>
            {icon}
          </div>
        )}
      </div>

      {loading ? (
        <div className="skeleton h-8 w-32 rounded-lg mb-2" />
      ) : (
        <div className="text-3xl font-bold tracking-tight mb-1" style={{ color }}>
          {prefix}{formatNum(count)}{suffix}
        </div>
      )}

      {change !== undefined && !loading && (
        <div className={`flex items-center gap-1 text-xs font-medium ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          <span>{isPositive ? '↑' : '↓'}</span>
          <span>{Math.abs(change)}% {changeLabel || 'vs last month'}</span>
        </div>
      )}
    </div>
  );
};

// ── Badge ─────────────────────────────────────────────────────────────
const Badge = ({ label, color = 'default', size = 'sm' }) => {
  const colors = {
    HOT:    'bg-red-500/15 text-red-400 border-red-500/25',
    WARM:   'bg-amber-500/15 text-amber-400 border-amber-500/25',
    COLD:   'bg-slate-500/15 text-slate-400 border-slate-500/25',
    ACTIVE: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    PAUSED: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    AI:     'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
    HUMAN:  'bg-violet-500/15 text-violet-400 border-violet-500/25',
    NEW:    'bg-slate-500/15 text-slate-400 border-slate-500/25',
    PRO:    'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
    default:'bg-slate-500/15 text-slate-400 border-slate-500/25',
  };
  const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  const colorClass = colors[label] || colors[color] || colors.default;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold ${sizeClass} ${colorClass}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
};

// ── Button ────────────────────────────────────────────────────────────
const Button = ({ children, onClick, variant = 'primary', size = 'md', className = '', disabled }) => {
  const base = 'inline-flex items-center gap-2 font-semibold rounded-xl transition-all duration-200 cursor-pointer border';
  const sizes = { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2', lg: 'text-base px-6 py-3' };
  const variants = {
    primary:  'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500/50 shadow-lg hover:shadow-indigo-500/25',
    secondary:'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700/50',
    ghost:    'bg-transparent hover:bg-slate-800/50 text-slate-300 border-slate-700/30',
    danger:   'bg-red-600/20 hover:bg-red-600/30 text-red-400 border-red-500/30',
    success:  'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border-emerald-500/30',
  };
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

// ── Skeleton ──────────────────────────────────────────────────────────
const Skeleton = ({ className = '' }) => (
  <div className={`skeleton rounded-xl ${className}`} />
);

// ── Score ring ────────────────────────────────────────────────────────
const ScoreRing = ({ score, size = 48 }) => {
  const pct = Math.min(100, Math.max(0, score));
  const color = score >= 80 ? '#ef4444' : score >= 55 ? '#f59e0b' : '#64748b';
  const r = (size / 2) - 4;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(30,41,59,0.8)" strokeWidth="3" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s ease', filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <span className="absolute text-xs font-bold font-mono" style={{ color }}>{pct}</span>
    </div>
  );
};

// ── Section header ────────────────────────────────────────────────────
const SectionHeader = ({ title, subtitle, action }) => (
  <div className="flex items-start justify-between mb-6">
    <div>
      <h2 className="text-lg font-bold text-slate-100 tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {action}
  </div>
);

// ── Empty state ───────────────────────────────────────────────────────
const EmptyState = ({ icon, title, desc }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="text-4xl mb-3 opacity-30">{icon}</div>
    <div className="text-slate-400 font-medium mb-1">{title}</div>
    <div className="text-slate-600 text-sm">{desc}</div>
  </div>
);

// ── Tooltip-style stat row ────────────────────────────────────────────
const StatRow = ({ label, value, color }) => (
  <div className="flex items-center justify-between py-2 border-b border-slate-800/50 last:border-0">
    <span className="text-sm text-slate-400">{label}</span>
    <span className="text-sm font-semibold" style={{ color: color || '#f1f5f9' }}>{value}</span>
  </div>
);

// ── Progress bar ──────────────────────────────────────────────────────
const ProgressBar = ({ value, max, color = '#6366f1', label }) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      {label && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-slate-400">{label}</span>
          <span className="text-xs font-mono text-slate-300">{pct.toFixed(0)}%</span>
        </div>
      )}
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-1000"
             style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}60` }} />
      </div>
    </div>
  );
};

// ── Pulse dot ─────────────────────────────────────────────────────────
const PulseDot = ({ color = '#10b981' }) => (
  <span className="relative inline-flex w-2.5 h-2.5">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
          style={{ background: color }} />
    <span className="relative inline-flex rounded-full w-2.5 h-2.5" style={{ background: color }} />
  </span>
);

// ── Custom chart tooltip ──────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label, prefix = '', suffix = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl p-3 shadow-xl text-xs">
      <div className="text-slate-400 mb-2 font-mono">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 font-semibold" style={{ color: p.color }}>
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          {prefix}{typeof p.value === 'number' ? p.value.toLocaleString('en-US') : p.value}{suffix}
        </div>
      ))}
    </div>
  );
};

// ── Input ─────────────────────────────────────────────────────────────
const Input = ({ label, value, onChange, placeholder, type = 'text', className = '' }) => (
  <div className={className}>
    {label && <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>}
    <input
      type={type}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      className="input-dark w-full rounded-xl px-4 py-2.5 text-sm"
    />
  </div>
);

// ── Toggle switch ─────────────────────────────────────────────────────
const Toggle = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-3 cursor-pointer">
    <div
      className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${checked ? 'bg-indigo-600' : 'bg-slate-700'}`}
      onClick={() => onChange?.(!checked)}
    >
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </div>
    {label && <span className="text-sm text-slate-300">{label}</span>}
  </label>
);

// ── SVG Charts ────────────────────────────────────────────────────────

// Smooth path from data points
const svgPath = (points, w, h, minY, maxY, tension = 0.4) => {
  if (!points?.length) return '';
  const xs = points.map((_, i) => (i / (points.length - 1)) * w);
  const ys = points.map(v => h - ((v - minY) / (maxY - minY || 1)) * h * 0.85 - h * 0.07);
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < xs.length - 1; i++) {
    const cpx = (xs[i] + xs[i+1]) / 2;
    d += ` C ${cpx} ${ys[i]}, ${cpx} ${ys[i+1]}, ${xs[i+1]} ${ys[i+1]}`;
  }
  return d;
};

const AreaChart = ({ data, dataKey, color = '#6366f1', height = 200, labels, prefix = '', suffix = '' }) => {
  const [hover, setHover] = React.useState(null);
  const values = data?.map(d => d[dataKey]) || [];
  const minY = Math.min(...values) * 0.9;
  const maxY = Math.max(...values) * 1.05;
  const W = 560, H = height;
  const path = svgPath(values, W, H, minY, maxY);
  const areaPath = path + ` L ${W} ${H} L 0 ${H} Z`;
  const id = `grad-${dataKey}-${Math.random().toString(36).slice(2,6)}`;
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - ((v - minY) / (maxY - minY || 1)) * H * 0.85 - H * 0.07,
    v,
    label: labels?.[i] || i,
  }));

  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none"
           onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0"    />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${id})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2"
              style={{ filter:`drop-shadow(0 0 6px ${color}80)` }} />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={hover?.i === i ? 5 : 3}
                  fill={color} stroke="#0f172a" strokeWidth="2"
                  style={{ cursor:'pointer', transition:'r 0.1s' }}
                  onMouseEnter={() => setHover({ ...p, i })} />
        ))}
      </svg>
      {/* X axis labels */}
      {labels && (
        <div className="flex justify-between px-1 mt-1">
          {labels.filter((_, i) => i % Math.ceil(labels.length / 6) === 0).map((l, i) => (
            <span key={i} className="text-[10px] text-slate-600 font-mono">{l}</span>
          ))}
        </div>
      )}
      {/* Tooltip */}
      {hover && (
        <div className="absolute pointer-events-none z-10 glass-strong rounded-lg px-3 py-2 text-xs"
             style={{ left: `${(hover.x / W) * 100}%`, top: 0, transform:'translateX(-50%)' }}>
          <div className="text-slate-400 font-mono mb-0.5">{hover.label}</div>
          <div className="font-bold" style={{ color }}>{prefix}{typeof hover.v === 'number' ? hover.v.toLocaleString('en-US') : hover.v}{suffix}</div>
        </div>
      )}
    </div>
  );
};

const BarChartSVG = ({ data, dataKey, color = '#6366f1', height = 200, labels, prefix = '', suffix = '' }) => {
  const [hover, setHover] = React.useState(null);
  const values = data?.map(d => d[dataKey]) || [];
  const maxY = Math.max(...values) * 1.1;
  const W = 560, H = height - 20;
  const barW = W / values.length * 0.6;
  const gap   = W / values.length;
  const id2   = `bgrad-${Math.random().toString(36).slice(2,6)}`;

  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <linearGradient id={id2} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.9" />
            <stop offset="100%" stopColor={color} stopOpacity="0.4" />
          </linearGradient>
        </defs>
        {values.map((v, i) => {
          const bh = (v / maxY) * H * 0.85;
          const x  = gap * i + gap * 0.2;
          const y  = H - bh;
          return (
            <g key={i} style={{ cursor:'pointer' }}
               onMouseEnter={() => setHover({ i, v, x: gap*i+gap/2, label: labels?.[i] || i })}
               onMouseLeave={() => setHover(null)}>
              <rect x={x} y={y} width={barW} height={bh}
                    fill={hover?.i === i ? color : `url(#${id2})`}
                    rx="3"
                    style={{ filter: hover?.i === i ? `drop-shadow(0 0 8px ${color})` : 'none', transition:'all 0.15s' }} />
            </g>
          );
        })}
      </svg>
      {labels && (
        <div className="flex justify-around px-1">
          {labels.map((l, i) => (
            <span key={i} className="text-[10px] text-slate-600 font-mono">{l}</span>
          ))}
        </div>
      )}
      {hover && (
        <div className="absolute pointer-events-none z-10 glass-strong rounded-lg px-3 py-2 text-xs"
             style={{ left:`${(hover.x / W) * 100}%`, top:0, transform:'translateX(-50%)' }}>
          <div className="text-slate-400 font-mono mb-0.5">{hover.label}</div>
          <div className="font-bold" style={{ color }}>{prefix}{typeof hover.v === 'number' ? hover.v.toLocaleString('pt-BR') : hover.v}{suffix}</div>
        </div>
      )}
    </div>
  );
};

const DonutChart = ({ data, colors, size = 160 }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  let cumulative = 0;
  const cx = size / 2, cy = size / 2, r = size * 0.35, ir = size * 0.22;

  const segments = data.map((d, i) => {
    const pct   = d.value / total;
    const start = cumulative * 2 * Math.PI - Math.PI / 2;
    cumulative += pct;
    const end   = cumulative * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end);
    const ix1 = cx + ir * Math.cos(start), iy1 = cy + ir * Math.sin(start);
    const ix2 = cx + ir * Math.cos(end),   iy2 = cy + ir * Math.sin(end);
    const large = pct > 0.5 ? 1 : 0;
    return {
      d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${ir} ${ir} 0 ${large} 0 ${ix1} ${iy1} Z`,
      color: colors[i], name: d.name, value: d.value, pct: (pct * 100).toFixed(1),
    };
  });

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size}>
        {segments.map((seg, i) => (
          <path key={i} d={seg.d} fill={seg.color}
                style={{ filter:`drop-shadow(0 0 4px ${seg.color}60)` }} />
        ))}
      </svg>
      <div className="space-y-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: seg.color }} />
            <span className="text-slate-400">{seg.name}</span>
            <span className="font-mono font-bold ml-auto" style={{ color: seg.color }}>{seg.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const RadarChartSVG = ({ data, color = '#6366f1', size = 200 }) => {
  const cx = size / 2, cy = size / 2;
  const r  = size * 0.38;
  const n  = data.length;
  const angle = (i) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (i, pct) => ({
    x: cx + r * pct * Math.cos(angle(i)),
    y: cy + r * pct * Math.sin(angle(i)),
  });

  const rings = [0.25, 0.5, 0.75, 1];
  const pts   = data.map((d, i) => pt(i, d.score / 100));
  const polyPts = pts.map(p => `${p.x},${p.y}`).join(' ');
  const axesPts = data.map((_, i) => pt(i, 1));

  return (
    <svg width={size} height={size}>
      {/* Grid rings */}
      {rings.map(pct => (
        <polygon key={pct}
          points={data.map((_, i) => { const p = pt(i, pct); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="rgba(99,102,241,0.12)" strokeWidth="1" />
      ))}
      {/* Axes */}
      {axesPts.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y}
              stroke="rgba(99,102,241,0.1)" strokeWidth="1" />
      ))}
      {/* Data polygon */}
      <polygon points={polyPts} fill={`${color}25`} stroke={color} strokeWidth="2"
               style={{ filter:`drop-shadow(0 0 6px ${color}60)` }} />
      {/* Labels */}
      {data.map((d, i) => {
        const lp = pt(i, 1.22);
        return (
          <text key={i} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
                fill="#64748b" fontSize="9" fontFamily="JetBrains Mono">
            {d.subject}
          </text>
        );
      })}
    </svg>
  );
};

// ── Theme hook — reads current theme from DOM ─────────────────────────
const useTheme = () => {
  const [theme, setTheme] = React.useState(
    () => document.documentElement.getAttribute('data-theme') || 'dark'
  );
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const isLight = theme === 'light';
  return {
    theme, isLight,
    // Common semantic tokens
    surfaceBg:    isLight ? '#FFFFFF'              : 'rgba(10,14,30,0.9)',
    surfaceBg2:   isLight ? 'rgba(0,0,0,0.02)'    : 'rgba(10,14,30,0.8)',
    messageBg:    isLight ? 'rgba(242,242,247,0.6)': 'rgba(3,7,18,0.4)',
    overlayBg:    isLight ? 'rgba(0,0,0,0.4)'      : 'rgba(3,7,18,0.8)',
    borderColor:  isLight ? 'rgba(0,0,0,0.08)'     : 'rgba(30,41,59,0.6)',
    accentColor:  isLight ? '#007AFF'               : '#818cf8',
    textPrimary:  isLight ? '#1C1C1E'               : '#f1f5f9',
    textSecondary:isLight ? '#8E8E93'               : '#94a3b8',
  };
};

// Export all
Object.assign(window, {
  Card, KPICard, Badge, Button, Skeleton, ScoreRing,
  SectionHeader, EmptyState, StatRow, ProgressBar,
  PulseDot, ChartTooltip, Input, Toggle, useTheme,
  AreaChart, BarChartSVG, DonutChart, RadarChartSVG,
});
