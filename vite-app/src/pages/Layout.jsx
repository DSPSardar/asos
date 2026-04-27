// src/pages/Layout.jsx — Authenticated app shell (sidebar + outlet)
import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@stores/auth.store';

const NAV = [
  { to: '/dashboard',     label: 'Dashboard',     icon: IconDashboard },
  { to: '/leads',         label: 'Leads',         icon: IconPipeline  },
  { to: '/conversations', label: 'Conversations', icon: IconChat      },
  { to: '/ai-insights',   label: 'AI Insights',   icon: IconSparkles  },
  { to: '/ads',           label: 'Ads',           icon: IconMegaphone },
  { to: '/analytics',     label: 'Analytics',     icon: IconBars      },
];

const SETTINGS_NAV = [
  { to: '/settings',   label: 'Settings', icon: IconSettings },
  { to: '/billing',    label: 'Billing',  icon: IconCard     },
  { to: '/onboarding', label: 'Onboarding', icon: IconRocket },
];

export default function Layout() {
  const navigate = useNavigate();
  const { user, tenant, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/auth', { replace: true });
  };

  const initials = (user?.name || user?.email || 'U')
    .split(/[\s@]/)[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-slate-100">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="flex w-60 flex-col border-r border-slate-800/60 bg-surface/40 backdrop-blur-xl">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-slate-800/60 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent2 glow-accent">
            <span className="text-sm font-bold text-white">A</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">ASOS</span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">AI Sales OS</span>
          </div>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavSection label="Workspace" items={NAV} />
          <NavSection label="Account" items={SETTINGS_NAV} className="mt-6" />
        </nav>

        {/* User menu */}
        <div className="relative border-t border-slate-800/60 p-3">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface2/60"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent2 text-xs font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user?.name || user?.email || 'Account'}</div>
              <div className="truncate text-xs text-slate-500">{tenant?.name || tenant?.slug || 'Boulevard Tower REIT'}</div>
            </div>
            <IconChevron className={`h-4 w-4 text-slate-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-lg border border-slate-700/50 bg-surface shadow-xl animate-fade-in">
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-surface2 hover:text-white"
              >
                <IconLogout className="h-4 w-4" />
                Log out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

// ── Nav section ────────────────────────────────────────────
function NavSection({ label, items, className = '' }) {
  return (
    <div className={className}>
      <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all ${
                  isActive
                    ? 'bg-accent/15 text-white shadow-[inset_0_0_0_1px_rgba(99,102,241,0.25)]'
                    : 'text-slate-400 hover:bg-surface2/60 hover:text-slate-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={`h-4 w-4 transition-colors ${isActive ? 'text-accent' : 'text-slate-500 group-hover:text-slate-300'}`} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Page header (re-exported helper for child pages) ──────
export function PageHeader({ title, subtitle, action }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800/60 bg-bg/80 px-8 py-5 backdrop-blur-xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

// ── Inline icons (SVG, no extra deps) ──────────────────────
function svgProps(props) { return { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', ...props }; }
function IconDashboard(p){ return <svg {...svgProps(p)}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>; }
function IconPipeline(p){ return <svg {...svgProps(p)}><path d="M3 6h18M6 12h12M9 18h6"/></svg>; }
function IconChat(p){ return <svg {...svgProps(p)}><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z"/></svg>; }
function IconSparkles(p){ return <svg {...svgProps(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>; }
function IconMegaphone(p){ return <svg {...svgProps(p)}><path d="M3 11v2a2 2 0 0 0 2 2h2l9 5V4l-9 5H5a2 2 0 0 0-2 2Z"/></svg>; }
function IconBars(p){ return <svg {...svgProps(p)}><path d="M4 19V10M10 19V5M16 19v-7M22 19H2"/></svg>; }
function IconSettings(p){ return <svg {...svgProps(p)}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3H9A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>; }
function IconCard(p){ return <svg {...svgProps(p)}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>; }
function IconRocket(p){ return <svg {...svgProps(p)}><path d="M4.5 16.5c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.9-.9.9-2.4 0-3.3a2.3 2.3 0 0 0-3.3.3ZM12 15l-3-3a22 22 0 0 1 4-7c1.6-2.4 3.5-3.6 6-3.5.1 2.5-1.1 4.4-3.5 6a22 22 0 0 1-7 4ZM9 12H4l4-4M15 9h5l-4 4"/></svg>; }
function IconChevron(p){ return <svg {...svgProps(p)}><path d="m6 9 6 6 6-6"/></svg>; }
function IconLogout(p){ return <svg {...svgProps(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>; }
