// src/pages/Auth.jsx — Login form wired to backend /auth/login
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@stores/auth.store';
import { authAPI } from '@lib/api';

export default function Auth() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await authAPI.login({ email, password });
      // The api.js response interceptor returns res.data, and the backend wraps
      // success responses in { success, data: { accessToken, refreshToken, user, tenant } }.
      // Be defensive about both shapes.
      const payload = res?.data ?? res;
      const { accessToken, refreshToken, user, tenant } = payload || {};
      if (!accessToken) throw new Error('Server did not return a token.');

      // PrivateRoute in main.jsx reads this localStorage key directly.
      localStorage.setItem('asos_token', accessToken);
      setAuth({ accessToken, refreshToken, user, tenant });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = err?.message || 'Login failed. Please try again.';
      // Friendly rewrite for the most common failure: backend unreachable
      if (/network|failed to fetch|ECONN|timeout/i.test(msg)) {
        setError("Couldn't reach the server. Is the backend running on :3000?");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = email.trim() && password.length > 0 && !submitting;

  // ── Dev-only shortcut: bypass real auth and seed a demo session.
  // TODO: remove (or gate behind import.meta.env.DEV) before production deploy.
  const skipLogin = () => {
    localStorage.setItem('asos_token', 'dev-skip-token');
    setAuth({
      accessToken:  'dev-skip-token',
      refreshToken: 'dev-skip-refresh',
      user:         { name: 'Dev User', email: 'dev@asos.io', role: 'TENANT_ADMIN' },
      tenant:       { name: 'Boulevard Tower REIT', slug: 'boulevardtower' },
    });
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="grid-bg flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Logo */}
        <div className="mb-7 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 glow-accent">
            <span className="text-base font-bold text-white">A</span>
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight">ASOS</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">AI Sales OS</div>
          </div>
        </div>

        {/* Card */}
        <div className="glass-card rounded-2xl p-7">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to your workspace.</p>

          {error && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300 animate-fade-in"
            >
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="leading-snug">{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            {/* Email */}
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-slate-400">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                placeholder="you@company.com"
                className="input-dark w-full rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 disabled:opacity-50"
              />
            </div>

            {/* Password */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-xs font-medium text-slate-400">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() =>
                    alert('Password reset is coming soon.\nFor now, email sales@asos.io to reset.')
                  }
                  className="text-xs text-slate-500 transition-colors hover:text-accent"
                >
                  Forgot?
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  placeholder="••••••••"
                  className="input-dark w-full rounded-lg px-3 py-2.5 pr-10 text-sm placeholder-slate-600 disabled:opacity-50"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 transition-colors hover:text-slate-300"
                >
                  {showPw ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent2 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <span aria-hidden>→</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Below card */}
        <p className="mt-6 text-center text-xs text-slate-500">
          No account?{' '}
          <a
            href="mailto:sales@asos.io?subject=ASOS%20demo%20request&body=Hi%2C%20I%27d%20like%20to%20try%20ASOS."
            className="text-slate-400 transition-colors hover:text-accent"
          >
            Contact sales →
          </a>
        </p>

        {/* Dev shortcut — remove before production */}
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={skipLogin}
            className="group inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-700/60 bg-slate-900/40 px-3 py-1.5 text-[11px] font-medium text-slate-500 transition-all hover:border-amber-400/30 hover:bg-amber-400/5 hover:text-amber-300"
            title="Bypass authentication and load demo data — remove before production"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400/60 group-hover:bg-amber-400" />
            Skip login (Dev Mode)
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline icons ──────────────────────────────────────────
function svgProps(p) { return { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', ...p }; }
function IconEye(p)    { return <svg {...svgProps(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IconEyeOff(p) { return <svg {...svgProps(p)}><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 11s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61M14.12 14.12A3 3 0 1 1 9.88 9.88M2 2l20 20"/></svg>; }
function IconAlert(p)  { return <svg {...svgProps(p)}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>; }
