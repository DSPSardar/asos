// src/pages/Layout.jsx — Authenticated app shell (sidebar + outlet)
import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@stores/auth.store';

const NAV = [
  { to: '/dashboard',     label: 'Dashboard',     icon: IconDashboard },
  { to: '/leads',         label: 'Leads',         icon: IconPipeline  },
  { to: '/conversations', label: 'Conversations', icon: IconChat      },
  { to: '/ai-insights',   label: 'AI Insights',   icon: IconSparkles  },
  { to: '/ads',           label: 'Ads',           icon: IconMegaphone },
  { to: '/analytics',     label: 'Analytics',     icon: IconBars      },
];

const DSP_NAV = [
  { to: '/students',      label: 'Students',      icon: IconGradCap   },
  { to: '/dsp-reports',   label: 'DSP Reports',   icon: IconReport    },
  { to: '/automations',   label: 'Automations',   icon: IconBolt      },
];

const SETTINGS_NAV = [
  { to: '/settings',   label: 'Settings', icon: IconSettings },
  { to: '/billing',    label: 'Billing',  icon: IconCard     },
  { to: '/onboarding', label: 'Onboarding', icon: IconRocket },
];

const ADMIN_NAV = [
  { to: '/admin', label: 'Admin Panel', icon: IconShield },
];

/** Read role directly from the JWT — synchronous, no Zustand hydration wait. */
function getRoleFromToken() {
  try {
    const tok = localStorage.getItem('asos_token');
    if (!tok) return null;
    return JSON.parse(atob(tok.split('.')[1])).role || null;
  } catch { return null; }
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, tenant, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Use JWT role as source of truth (synchronous), fall back to Zustand store
  const role = user?.role || getRoleFromToken();
  const isSuperAdmin = role === 'SUPERADMIN';

  // Close drawer when route changes (mobile nav tap)
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // ESC closes drawer
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

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
      {/* ── Mobile drawer backdrop ──────────────────────────── */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* ── Sidebar (drawer < md, static ≥ md) ──────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-slate-800/60 bg-surface/95 backdrop-blur-xl transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 md:bg-surface/40 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo + mobile close */}
        <div className="flex h-16 items-center gap-2 border-b border-slate-800/60 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent2 glow-accent">
            <span className="text-sm font-bold text-white">A</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">ASOS</span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">AI Sales OS</span>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
            className="ml-auto rounded-md p-1.5 text-slate-400 transition-colors hover:bg-surface2/60 hover:text-slate-100 md:hidden"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavSection label="Workspace" items={NAV} />
          <NavSection label="DSP — EdTech" items={DSP_NAV} className="mt-6" />
          <NavSection label="Account" items={SETTINGS_NAV} className="mt-6" />
          {isSuperAdmin && (
            <NavSection label="Platform" items={ADMIN_NAV} className="mt-6" />
          )}
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
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar (hamburger + brand) — hidden ≥ md */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800/60 bg-surface/40 px-4 backdrop-blur-xl md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="-ml-1 rounded-md p-2 text-slate-300 transition-colors hover:bg-surface2/60 hover:text-white"
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent2 glow-accent">
            <span className="text-xs font-bold text-white">A</span>
          </div>
          <span className="text-sm font-semibold tracking-tight">ASOS</span>
        </div>

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
function IconMenu(p){ return <svg {...svgProps(p)}><path d="M3 6h18M3 12h18M3 18h18"/></svg>; }
function IconClose(p){ return <svg {...svgProps(p)}><path d="M18 6 6 18M6 6l12 12"/></svg>; }
function IconGradCap(p){ return <svg {...svgProps(p)}><path d="M22 10v6M2 10l10-5 10 5-10 5-10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>; }
function IconReport(p){ return <svg {...svgProps(p)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>; }
function IconBolt(p){ return <svg {...svgProps(p)}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>; }
function IconShield(p){ return <svg {...svgProps(p)}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>; }
