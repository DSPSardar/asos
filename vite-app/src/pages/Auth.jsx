// src/pages/Auth.jsx — Login + Register with branded two-panel layout
import React, { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@stores/auth.store';
import { authAPI } from '@lib/api';

// ── Password strength helper ───────────────────────────────────────────
function getStrength(val) {
  let score = 0;
  if (val.length >= 8)            score++;
  if (/[A-Z]/.test(val))          score++;
  if (/[0-9]/.test(val))          score++;
  if (/[^A-Za-z0-9]/.test(val))   score++;
  const colors = ['#ef4444', '#f59e0b', '#f59e0b', '#10b981'];
  const labels = ['Too short', 'Weak', 'Good', 'Strong 💪'];
  return { score, color: colors[score - 1] || '#1e293b', label: val.length > 0 ? labels[score - 1] || '' : '' };
}

// ── Slug normaliser ────────────────────────────────────────────────────
function normaliseSlug(val) {
  return val.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

export default function Auth() {
  const navigate       = useNavigate();
  const [params]       = useSearchParams();
  const setAuth        = useAuthStore((s) => s.setAuth);

  // tab is driven by ?tab=register query param so links can deep-link
  const [tab, setTab]           = useState(params.get('tab') === 'register' ? 'register' : 'login');
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [submitting, setSubmit] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  // login fields
  const [loginEmail, setLoginEmail]       = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw]     = useState(false);

  // register fields
  const [regBusiness, setRegBusiness] = useState('');
  const [regName, setRegName]         = useState('');
  const [regSlug, setRegSlug]         = useState('');
  const [regEmail, setRegEmail]       = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPw, setShowRegPw]     = useState(false);
  const [strength, setStrength]       = useState({ score: 0, color: '#1e293b', label: '' });
  const [slugFeedback, setSlugFeedback] = useState('');
  const [termsOk, setTermsOk]         = useState(false);

  // forgot password
  const [forgotEmail, setForgotEmail] = useState('');

  const clearMessages = () => { setError(''); setSuccess(''); };

  const switchTab = (t) => {
    clearMessages();
    setTab(t);
  };

  // ── Login ────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    if (submitting) return;
    clearMessages();
    setSubmit(true);
    try {
      const res = await authAPI.login({ email: loginEmail, password: loginPassword });
      const payload = res?.data ?? res;
      const { accessToken, refreshToken, user, tenant } = payload || {};
      if (!accessToken) throw new Error('Server did not return a token.');
      localStorage.setItem('asos_token', accessToken);
      setAuth({ accessToken, refreshToken, user, tenant });
      setSuccess('Login successful! Redirecting…');
      setTimeout(() => navigate('/dashboard', { replace: true }), 800);
    } catch (err) {
      const msg = err?.message || 'Login failed. Please try again.';
      if (/network|failed to fetch|ECONN|timeout/i.test(msg)) {
        setError("Couldn't reach the server. Is the API running?");
      } else {
        setError(msg);
      }
    } finally {
      setSubmit(false);
    }
  };

  // ── Register ─────────────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    if (submitting) return;
    clearMessages();
    if (!termsOk) { setError('Please accept the Terms of Service to continue.'); return; }
    if (regSlug.length < 3) { setError('Workspace slug must be at least 3 characters.'); return; }
    setSubmit(true);
    try {
      const res = await authAPI.register({
        tenantName: regBusiness,
        tenantSlug: regSlug,
        email:      regEmail,
        password:   regPassword,
        fullName:   regName,
      });
      const payload = res?.data ?? res;
      const { accessToken, refreshToken, user, tenant } = payload || {};
      if (!accessToken) throw new Error('Registration failed — no token returned.');
      localStorage.setItem('asos_token', accessToken);
      setAuth({ accessToken, refreshToken, user, tenant });
      setSuccess('Account created! Setting up your workspace…');
      setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
    } catch (err) {
      setError(err?.message || 'Registration failed. Please try again.');
    } finally {
      setSubmit(false);
    }
  };

  // ── Forgot password ───────────────────────────────────────────────────
  const handleForgot = (e) => {
    e.preventDefault();
    setShowForgot(false);
    setSuccess('If that email exists, a reset link is on its way. Check your inbox.');
  };

  // ── Slug input ────────────────────────────────────────────────────────
  const onSlugChange = useCallback((val) => {
    const clean = normaliseSlug(val);
    setRegSlug(clean);
    if (clean.length < 3) {
      setSlugFeedback({ text: 'Min 3 characters', ok: false });
    } else {
      setSlugFeedback({ text: `✓ getaisales.com/${clean}`, ok: true });
    }
  }, []);

  const strengthBars = Array.from({ length: 4 }, (_, i) => ({
    active: i < strength.score,
    color:  strength.color,
  }));

  const indicatorLeft  = tab === 'login' ? '4px' : 'calc(50%)';
  const indicatorWidth = 'calc(50% - 4px)';

  return (
    <div className="min-h-screen flex relative overflow-hidden" style={{ background: '#030712' }}>
      {/* ── Grid background ── */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(99,102,241,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.04) 1px,transparent 1px)',
        backgroundSize: '56px 56px',
      }} />

      {/* ── Background orbs ── */}
      <div className="absolute top-0 left-0 w-96 h-96 rounded-full pointer-events-none opacity-20"
           style={{ background: 'radial-gradient(circle,#6366f1,transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none opacity-15"
           style={{ background: 'radial-gradient(circle,#8b5cf6,transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full pointer-events-none opacity-10"
           style={{ background: 'radial-gradient(circle,#06b6d4,transparent 70%)', filter: 'blur(80px)' }} />

      {/* ── LEFT PANEL — Branding ── */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.08) 0%,rgba(139,92,246,0.05) 100%)' }}>

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center glow-accent"
               style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            <span className="text-white font-bold text-lg">A</span>
          </div>
          <div>
            <div className="text-lg font-bold text-white tracking-tight">getaisales</div>
            <div className="text-[10px] text-indigo-400 tracking-widest font-mono">.com · AI SALES</div>
          </div>
        </div>

        {/* Center content */}
        <div className="flex-1 flex flex-col justify-center py-12">
          <div className="mb-2 text-xs font-semibold text-indigo-400 uppercase tracking-widest">The Future of Sales</div>
          <h1 className="text-5xl font-bold leading-tight tracking-tight mb-6 text-white">
            Close deals while<br />
            <span className="gradient-text">you sleep.</span>
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed mb-10 max-w-md">
            Claude AI qualifies every lead, diagnoses their problem, and sends the perfect WhatsApp message — automatically.
          </p>

          {/* Features */}
          <div className="space-y-3 mb-10">
            {[
              { icon: '◎', title: 'Claude AI Engine', desc: 'Qualifies, diagnoses & closes leads via WhatsApp' },
              { icon: '◈', title: 'Multi-tenant CRM',  desc: 'Full pipeline, contacts & activity tracking' },
              { icon: '⬗', title: 'Meta Ads Attribution', desc: 'Server-side CAPI for pixel-perfect ROI' },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-4 p-4 rounded-2xl transition-colors"
                   style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.1)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                     style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>{f.icon}</div>
                <div>
                  <div className="text-sm font-semibold text-slate-200 mb-0.5">{f.title}</div>
                  <div className="text-xs text-slate-500">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="flex gap-4">
            {[['78%', 'AI handling rate'], ['11.1%', 'Conversion rate'], ['5.68x', 'Avg ROAS']].map(([val, label]) => (
              <div key={label} className="flex flex-col items-center p-4 rounded-2xl text-center"
                   style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(99,102,241,0.12)' }}>
                <div className="text-2xl font-bold gradient-text font-mono">{val}</div>
                <div className="text-xs text-slate-500 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Floating AI card */}
        <div className="absolute bottom-32 right-0 w-64 rounded-2xl p-4 glass"
             style={{ animation: 'float 4s ease-in-out infinite' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm"
                 style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>◎</div>
            <span className="text-xs font-semibold text-indigo-300">Claude AI · Active</span>
            <span className="ml-auto relative flex w-2 h-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-500" />
            </span>
          </div>
          <div className="text-xs text-slate-400 leading-relaxed mb-3">
            "Based on your answers, I can see this is costing you ~$40k/month in lost leads. Let me show you how we fix this…"
          </div>
          <div className="flex items-center gap-2">
            <div className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                 style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>● HOT</div>
            <span className="text-[10px] text-slate-600">Score 91/100</span>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL — Auth form ── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12 relative z-10">
        <div className="w-full max-w-md">

          {/* Form card */}
          <div className="glass rounded-3xl p-8">

            {/* Mobile logo */}
            <div className="lg:hidden flex items-center justify-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                   style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                <span className="text-white font-bold text-lg">A</span>
              </div>
              <span className="text-lg font-bold text-white">getaisales.com</span>
            </div>

            {/* Header */}
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-slate-100 mb-1">
                {tab === 'login' ? 'Welcome back' : 'Start free trial'}
              </h2>
              <p className="text-sm text-slate-500">
                {tab === 'login' ? 'Sign in to your sales command center' : '14 days free · No credit card required'}
              </p>
            </div>

            {/* Tab switcher */}
            <div className="flex relative p-1 rounded-xl mb-6"
                 style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(99,102,241,0.1)' }}>
              <div className="absolute top-1 bottom-1 rounded-lg transition-all duration-300"
                   style={{
                     background: 'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(139,92,246,0.15))',
                     border: '1px solid rgba(99,102,241,0.25)',
                     left: indicatorLeft,
                     width: indicatorWidth,
                   }} />
              {[['login', 'Sign In'], ['register', 'Get Started']].map(([t, label]) => (
                <button key={t} type="button"
                        onClick={() => switchTab(t)}
                        className="flex-1 py-2.5 text-sm font-semibold text-center rounded-lg transition-colors relative z-10 cursor-pointer"
                        style={{ color: tab === t ? '#f1f5f9' : '#475569' }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Error/success banners */}
            {error && (
              <div className="mb-4 p-3 rounded-xl text-sm text-red-400"
                   style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </div>
            )}
            {success && (
              <div className="mb-4 p-3 rounded-xl text-sm text-emerald-400"
                   style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                {success}
              </div>
            )}

            {/* ── LOGIN FORM ── */}
            {tab === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4" noValidate>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Email</label>
                  <input type="email" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)}
                         placeholder="you@company.com" disabled={submitting}
                         className="w-full rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all"
                         style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)' }}
                         onFocus={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.6)'}
                         onBlur={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.2)'} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Password</label>
                    <button type="button" onClick={() => setShowForgot(true)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input type={showLoginPw ? 'text' : 'password'} required value={loginPassword}
                           onChange={(e) => setLoginPassword(e.target.value)}
                           placeholder="••••••••" disabled={submitting}
                           className="w-full rounded-xl px-4 py-3 pr-12 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all"
                           style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)' }}
                           onFocus={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.6)'}
                           onBlur={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.2)'} />
                    <button type="button" tabIndex={-1}
                            onClick={() => setShowLoginPw((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-base">
                      {showLoginPw ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={submitting || !loginEmail || !loginPassword}
                        className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
                        style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 4px 24px rgba(99,102,241,0.3)' }}>
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Signing in…
                    </span>
                  ) : 'Sign In →'}
                </button>
              </form>
            )}

            {/* ── REGISTER FORM ── */}
            {tab === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4" noValidate>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Business Name</label>
                    <AuthInput value={regBusiness} onChange={(e) => setRegBusiness(e.target.value)}
                               placeholder="Acme Corp" required disabled={submitting} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Your Name</label>
                    <AuthInput value={regName} onChange={(e) => setRegName(e.target.value)}
                               placeholder="John Smith" required disabled={submitting} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Workspace Slug</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-xs font-mono pointer-events-none">
                      getaisales.com/
                    </span>
                    <input type="text" required disabled={submitting} value={regSlug}
                           onChange={(e) => onSlugChange(e.target.value)}
                           placeholder="acme-corp"
                           className="w-full rounded-xl pl-[7.5rem] pr-4 py-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all"
                           style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)' }}
                           onFocus={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.6)'}
                           onBlur={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.2)'} />
                  </div>
                  {slugFeedback && (
                    <div className="text-[10px] mt-1" style={{ color: slugFeedback.ok ? '#10b981' : '#ef4444' }}>
                      {slugFeedback.text}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Work Email</label>
                  <AuthInput type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)}
                             placeholder="you@company.com" required disabled={submitting} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
                  <div className="relative">
                    <input type={showRegPw ? 'text' : 'password'} required disabled={submitting}
                           value={regPassword}
                           onChange={(e) => { setRegPassword(e.target.value); setStrength(getStrength(e.target.value)); }}
                           placeholder="Min. 8 characters"
                           className="w-full rounded-xl px-4 py-3 pr-12 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all"
                           style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)' }}
                           onFocus={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.6)'}
                           onBlur={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.2)'} />
                    <button type="button" tabIndex={-1} onClick={() => setShowRegPw((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-base">
                      {showRegPw ? '🙈' : '👁'}
                    </button>
                  </div>
                  {/* Strength bars */}
                  <div className="flex gap-1 mt-2">
                    {strengthBars.map((bar, i) => (
                      <div key={i} className="flex-1 h-[3px] rounded-full transition-all duration-300"
                           style={{ background: bar.active ? strength.color : '#1e293b' }} />
                    ))}
                  </div>
                  {strength.label && (
                    <div className="text-[10px] mt-1" style={{ color: strength.color }}>{strength.label}</div>
                  )}
                </div>

                <div className="flex items-start gap-3 py-1">
                  <input type="checkbox" id="terms" checked={termsOk} onChange={(e) => setTermsOk(e.target.checked)}
                         className="mt-0.5 rounded flex-shrink-0 cursor-pointer" style={{ accentColor: '#6366f1' }} />
                  <label htmlFor="terms" className="text-xs text-slate-400 cursor-pointer leading-relaxed">
                    I agree to the{' '}
                    <a href="#" className="text-indigo-400 hover:text-indigo-300">Terms of Service</a>
                    {' '}and{' '}
                    <a href="#" className="text-indigo-400 hover:text-indigo-300">Privacy Policy</a>
                  </label>
                </div>

                <button type="submit" disabled={submitting || !regBusiness || !regName || !regEmail || !regPassword || !termsOk}
                        className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
                        style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 4px 24px rgba(99,102,241,0.3)' }}>
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creating account…
                    </span>
                  ) : 'Create Free Account →'}
                </button>
              </form>
            )}

            {/* ── Divider ── */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.1)' }} />
              <span className="text-xs text-slate-600">or</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.1)' }} />
            </div>

            {/* Bottom actions */}
            <div className="grid grid-cols-2 gap-3">
              <a href="https://getaisales.com" target="_blank" rel="noreferrer"
                 className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium text-slate-400 transition-all hover:text-slate-200"
                 style={{ border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(15,23,42,0.6)' }}>
                ← Back to site
              </a>
              <a href="mailto:sales@getaisales.com?subject=Demo%20Request"
                 className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium text-slate-400 transition-all hover:text-slate-200"
                 style={{ border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(15,23,42,0.6)' }}>
                Contact sales →
              </a>
            </div>

            {/* Footer note */}
            <p className="text-center text-xs text-slate-600 mt-5">
              14-day free trial · No credit card required · Cancel anytime
            </p>
          </div>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-6 mt-6 text-xs text-slate-700">
            <div className="flex items-center gap-1.5">🔒 <span>End-to-end encrypted</span></div>
            <div className="flex items-center gap-1.5">⚡ <span>99.9% uptime</span></div>
          </div>
        </div>
      </div>

      {/* ── Forgot password modal ── */}
      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="glass rounded-3xl p-8 w-full max-w-sm relative">
            <button onClick={() => setShowForgot(false)}
                    className="absolute top-4 right-5 text-slate-500 hover:text-slate-300 text-2xl leading-none">
              ×
            </button>
            <h3 className="text-lg font-bold text-slate-100 mb-2">Reset Password</h3>
            <p className="text-sm text-slate-400 mb-6">Enter your email and we'll send a reset link.</p>
            <form onSubmit={handleForgot} className="space-y-4">
              <AuthInput type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                         placeholder="you@company.com" required />
              <button type="submit"
                      className="w-full rounded-xl py-3 text-sm font-semibold text-white"
                      style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                Send Reset Link →
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Float animation keyframes ── */}
      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}`}</style>
    </div>
  );
}

// ── Reusable styled input ─────────────────────────────────────────────
function AuthInput({ className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all ${className}`}
      style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)' }}
      onFocus={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.6)'}
      onBlur={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.2)'}
      {...props}
    />
  );
}
