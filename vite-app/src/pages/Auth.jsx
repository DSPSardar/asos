// src/pages/Auth.jsx — Login + Register with branded two-panel layout
import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuthStore } from '@stores/auth.store';
import { authAPI } from '@lib/api';

const GOOGLE_ENABLED = !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || 'ASOS';
const MARKETING_URL = import.meta.env.VITE_MARKETING_URL || 'https://www.digitalservicesprogram.com';
const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL || 'info@digitalservicesprogram.com';

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

// ── Auto-generate slug from email ─────────────────────────────────────
function slugFromEmail(email) {
  return email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export default function Auth() {
  const navigate       = useNavigate();
  const [params]       = useSearchParams();
  const setAuth        = useAuthStore((s) => s.setAuth);
  const startDemo      = useAuthStore((s) => s.startDemo);

  // tab is driven by ?tab=register query param so links can deep-link
  const [tab, setTab]           = useState(params.get('tab') === 'register' ? 'register' : 'login');
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [submitting, setSubmit] = useState(false);
  const [showForgot, setShowForgot] = useState(params.get('forgot') === '1');

  // login fields
  const [loginEmail, setLoginEmail]       = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw]     = useState(false);
  const [loginFieldErrors, setLoginFieldErrors] = useState({});

  // register fields
  const [regName, setRegName]         = useState('');
  const [regEmail, setRegEmail]       = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPhone, setRegPhone]       = useState('');
  const [showRegPw, setShowRegPw]     = useState(false);
  const [strength, setStrength]       = useState({ score: 0, color: '#1e293b', label: '' });
  const [termsOk, setTermsOk]         = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});    // per-field errors for register form
  const [emailExistsHint, setEmailExistsHint] = useState(false); // "sign in instead?" nudge

  // Post-OAuth phone capture modal
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneModalValue, setPhoneModalValue] = useState('');
  const [phoneModalError, setPhoneModalError] = useState('');
  const [phoneModalSubmitting, setPhoneModalSubmitting] = useState(false);

  // forgot password
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  const clearMessages = () => {
    setError('');
    setSuccess('');
    setFieldErrors({});
    setLoginFieldErrors({});
    setEmailExistsHint(false);
  };

  const switchTab = (t) => {
    clearMessages();
    setTab(t);
  };

  // ── Client-side validation ───────────────────────────────────────────
  const validateLogin = () => {
    const errs = {};
    if (!loginEmail.trim())                           errs.email    = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)) errs.email = 'Enter a valid email address';
    if (!loginPassword)                               errs.password = 'Password is required';
    return errs;
  };

  const validateRegister = () => {
    const errs = {};
    if (!regName.trim() || regName.trim().length < 2)
      errs.name = 'Please enter your full name (min. 2 characters)';
    if (!regEmail.trim())
      errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail))
      errs.email = 'Enter a valid email address';
    if (!regPassword)
      errs.password = 'Password is required';
    else if (regPassword.length < 8)
      errs.password = 'Password must be at least 8 characters';
    if (regPhone.trim() && !/^\+[1-9]\d{7,14}$/.test(regPhone.trim()))
      errs.phone = 'Use E.164 format: +923001234567 (country code + number, no spaces)';
    if (!termsOk)
      errs.terms = 'Please accept the Terms of Service to continue';
    return errs;
  };

  // ── Friendly error parser ────────────────────────────────────────────
  const parseRegisterError = (msg = '') => {
    if (/email.*already|already.*registered|email.*taken|account.*exist/i.test(msg)) {
      setEmailExistsHint(true);
      return { email: 'This email is already registered.' };
    }
    if (/slug.*taken|tenant.*taken|already.*taken/i.test(msg)) {
      // Slug collision is retried silently — if we still reach here something else is wrong
      return null; // will fall to global error
    }
    if (/password.*short|password.*weak|password.*8/i.test(msg)) {
      return { password: msg };
    }
    if (/phone.*format|E\.164/i.test(msg)) {
      return { phone: 'Use E.164 format: +923001234567' };
    }
    if (/record.*already.*exists|unique.*constraint/i.test(msg)) {
      setEmailExistsHint(true);
      return { email: 'This email is already registered.' };
    }
    return null;
  };

  // ── Login ────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    if (submitting) return;
    clearMessages();

    const errs = validateLogin();
    if (Object.keys(errs).length) { setLoginFieldErrors(errs); return; }

    setSubmit(true);
    try {
      const res = await authAPI.login({ email: loginEmail, password: loginPassword });
      const payload = res?.data ?? res;
      const { accessToken, refreshToken, user, tenant } = payload || {};
      if (!accessToken) throw new Error('Server did not return a token.');
      localStorage.setItem('asos_token', accessToken);
      setAuth({ accessToken, refreshToken, user, tenant });
      setSuccess('Login successful! Redirecting…');
      // SUPERADMIN has no tenant — send directly to admin panel
      const destination = user?.role === 'SUPERADMIN' ? '/admin' : '/dashboard';
      setTimeout(() => navigate(destination, { replace: true }), 800);
    } catch (err) {
      const msg = err?.message || 'Login failed. Please try again.';
      if (/network|failed to fetch|ECONN|timeout/i.test(msg)) {
        setError("Can't reach the server. Please check your connection and try again.");
      } else if (/invalid credentials|invalid.*password|wrong.*password/i.test(msg)) {
        setError('Incorrect email or password. Please try again.');
      } else if (/suspended/i.test(msg)) {
        setError('This account has been suspended. Please contact support.');
      } else if (/pending approval/i.test(msg)) {
        setError('⏳ Your account is pending approval. You will receive access once an admin reviews your registration.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmit(false);
    }
  };

  // ── Demo skip login ───────────────────────────────────────────────────
  const handleSkip = async () => {
    if (submitting) return;
    clearMessages();
    setSubmit(true);
    try {
      startDemo();
      setSuccess('Entering demo workspace…');
      setTimeout(() => navigate('/dashboard', { replace: true }), 600);
    } catch {
      setError('Demo preview could not start. Please refresh and try again.');
    } finally {
      setSubmit(false);
    }
  };

  // ── Google login ─────────────────────────────────────────────────────
  const handleGoogleSuccess = async (tokenResponse) => {
    clearMessages();
    setSubmit(true);
    try {
      const res = await authAPI.googleAuth(tokenResponse.access_token);
      const payload = res?.data ?? res;
      const { accessToken, refreshToken, user, tenant, isNewUser } = payload || {};
      if (!accessToken) throw new Error('Google login failed.');
      localStorage.setItem('asos_token', accessToken);
      setAuth({ accessToken, refreshToken, user, tenant });
      if (isNewUser) {
        // New signup via Google — show phone modal before navigating to dashboard
        setShowPhoneModal(true);
      } else {
        setSuccess('Signed in with Google! Redirecting…');
        setTimeout(() => navigate('/dashboard', { replace: true }), 800);
      }
    } catch (err) {
      setError(err?.message || 'Google sign-in failed. Please try again.');
    } finally {
      setSubmit(false);
    }
  };

  // ── Post-OAuth phone submission ────────────────────────────────────────
  const handlePhoneModalSubmit = async (e) => {
    e.preventDefault();
    const cleaned = phoneModalValue.trim();
    // "Skip" path — no phone entered, just go to dashboard
    if (!cleaned) { navigate('/dashboard', { replace: true }); return; }
    setPhoneModalError('');
    setPhoneModalSubmitting(true);
    try {
      await authAPI.savePhone(cleaned);
      setShowPhoneModal(false);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setPhoneModalError(err?.message || 'Could not save number — check format and try again.');
    } finally {
      setPhoneModalSubmitting(false);
    }
  };

  // ── Register ─────────────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    if (submitting) return;
    clearMessages();

    // Client-side validation first — no API call until inputs are valid
    const errs = validateRegister();
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    setSubmit(true);
    try {
      const baseSlug = slugFromEmail(regEmail);
      const phoneVal = regPhone.trim();

      const doRegister = (slug) => authAPI.register({
        tenantName: regName.trim(),
        tenantSlug: slug,
        email:      regEmail.trim().toLowerCase(),
        password:   regPassword,
        fullName:   regName.trim(),
        ...(phoneVal ? { phone: phoneVal } : {}),
      });

      let res;
      try {
        res = await doRegister(baseSlug);
      } catch (firstErr) {
        // Slug taken → silently retry with a random suffix (user never sees this)
        if (/slug.*taken|already.*taken/i.test(firstErr?.message || '')) {
          const suffix = Math.random().toString(36).slice(2, 6);
          res = await doRegister(`${baseSlug}-${suffix}`);
        } else {
          throw firstErr;
        }
      }

      const payload = res?.data ?? res;
      const { accessToken, refreshToken, user, tenant, pendingApproval } = payload || {};

      // New registrations go into PENDING_APPROVAL — no token issued until admin approves
      if (pendingApproval) {
        setSuccess('✅ Account registered! Your account is now pending admin approval. You will be able to login once approved.');
        return;
      }

      if (!accessToken) throw new Error('Registration failed — no token returned.');
      localStorage.setItem('asos_token', accessToken);
      setAuth({ accessToken, refreshToken, user, tenant });
      setSuccess('Account created! Setting up your workspace…');
      setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
    } catch (err) {
      const msg = err?.message || '';
      if (/network|failed to fetch|ECONN|timeout/i.test(msg)) {
        setError("Can't reach the server. Please check your connection and try again.");
        return;
      }
      // Try to map to a field-level error
      const mapped = parseRegisterError(msg);
      if (mapped) {
        setFieldErrors(mapped);
      } else {
        setError(msg || 'Registration failed. Please try again.');
      }
    } finally {
      setSubmit(false);
    }
  };

  // ── Forgot password ───────────────────────────────────────────────────
  const handleForgot = async (e) => {
    e.preventDefault();
    if (forgotSubmitting) return;
    setForgotError('');
    setForgotSubmitting(true);
    try {
      await authAPI.forgotPassword(forgotEmail.trim().toLowerCase());
      setShowForgot(false);
      setSuccess('If that email has an ASOS account, a secure reset link is on its way. Check your inbox and spam folder.');
    } catch (err) {
      setForgotError(err?.message || 'Could not send the reset email. Please try again.');
    } finally {
      setForgotSubmitting(false);
    }
  };

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
            <div className="text-lg font-bold text-white tracking-tight">{BRAND_NAME}</div>
            <div className="text-[10px] text-indigo-400 tracking-widest font-mono">AI SALES OPERATING SYSTEM</div>
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
              <span className="text-lg font-bold text-white">{BRAND_NAME}</span>
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
                  <AuthInput
                    type="email" value={loginEmail} placeholder="you@company.com"
                    disabled={submitting} error={!!loginFieldErrors.email}
                    onChange={(e) => { setLoginEmail(e.target.value); setLoginFieldErrors((p) => ({ ...p, email: '' })); }}
                  />
                  <FieldError msg={loginFieldErrors.email} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Password</label>
                    <button type="button" onClick={() => { setForgotEmail(loginEmail); setForgotError(''); setShowForgot(true); }}
                            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <AuthInput
                      type={showLoginPw ? 'text' : 'password'} value={loginPassword}
                      placeholder="••••••••" disabled={submitting} error={!!loginFieldErrors.password}
                      className="pr-12"
                      onChange={(e) => { setLoginPassword(e.target.value); setLoginFieldErrors((p) => ({ ...p, password: '' })); }}
                    />
                    <button type="button" tabIndex={-1}
                            onClick={() => setShowLoginPw((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-base">
                      {showLoginPw ? '🙈' : '👁'}
                    </button>
                  </div>
                  <FieldError msg={loginFieldErrors.password} />
                </div>
                <button type="submit" disabled={submitting}
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
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Your Name</label>
                  <AuthInput
                    value={regName} placeholder="John Smith" disabled={submitting}
                    error={!!fieldErrors.name}
                    onChange={(e) => { setRegName(e.target.value); setFieldErrors((p) => ({ ...p, name: '' })); }}
                  />
                  <FieldError msg={fieldErrors.name} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Email</label>
                  <AuthInput
                    type="email" value={regEmail} placeholder="you@company.com" disabled={submitting}
                    error={!!fieldErrors.email}
                    onChange={(e) => { setRegEmail(e.target.value); setFieldErrors((p) => ({ ...p, email: '' })); setEmailExistsHint(false); }}
                  />
                  {/* Smart hint when email already exists */}
                  {emailExistsHint ? (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-red-400">
                      <span>⚠</span> This email is already registered.{' '}
                      <button type="button"
                        onClick={() => { switchTab('login'); setLoginEmail(regEmail); }}
                        className="underline text-indigo-400 hover:text-indigo-300 font-semibold">
                        Sign in instead →
                      </button>
                    </p>
                  ) : (
                    <FieldError msg={fieldErrors.email} />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
                  <div className="relative">
                    <AuthInput
                      type={showRegPw ? 'text' : 'password'} disabled={submitting}
                      value={regPassword} placeholder="Min. 8 characters"
                      error={!!fieldErrors.password} className="pr-12"
                      onChange={(e) => {
                        setRegPassword(e.target.value);
                        setStrength(getStrength(e.target.value));
                        setFieldErrors((p) => ({ ...p, password: '' }));
                      }}
                    />
                    <button type="button" tabIndex={-1} onClick={() => setShowRegPw((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-base">
                      {showRegPw ? '🙈' : '👁'}
                    </button>
                  </div>
                  {/* Strength bars — only show when typing */}
                  {regPassword.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {strengthBars.map((bar, i) => (
                        <div key={i} className="flex-1 h-[3px] rounded-full transition-all duration-300"
                             style={{ background: bar.active ? strength.color : '#1e293b' }} />
                      ))}
                    </div>
                  )}
                  {fieldErrors.password ? (
                    <FieldError msg={fieldErrors.password} />
                  ) : strength.label && regPassword.length > 0 ? (
                    <div className="text-[10px] mt-1" style={{ color: strength.color }}>{strength.label}</div>
                  ) : null}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    WhatsApp Number <span className="normal-case font-normal text-slate-600">(optional)</span>
                  </label>
                  <AuthInput
                    type="tel" value={regPhone} placeholder="+923001234567" disabled={submitting}
                    error={!!fieldErrors.phone}
                    onChange={(e) => { setRegPhone(e.target.value); setFieldErrors((p) => ({ ...p, phone: '' })); }}
                  />
                  {fieldErrors.phone ? (
                    <FieldError msg={fieldErrors.phone} />
                  ) : (
                    <p className="mt-1 text-[10px] text-slate-600">E.164 format — country code + number, no spaces</p>
                  )}
                </div>

                <div>
                  <div className="flex items-start gap-3 py-1">
                    <input type="checkbox" id="terms" checked={termsOk}
                           onChange={(e) => { setTermsOk(e.target.checked); setFieldErrors((p) => ({ ...p, terms: '' })); }}
                           className="mt-0.5 rounded flex-shrink-0 cursor-pointer" style={{ accentColor: '#6366f1' }} />
                    <label htmlFor="terms" className="text-xs text-slate-400 cursor-pointer leading-relaxed">
                      I agree to the{' '}
                      <a href="#" className="text-indigo-400 hover:text-indigo-300">Terms of Service</a>
                      {' '}and{' '}
                      <a href="#" className="text-indigo-400 hover:text-indigo-300">Privacy Policy</a>
                    </label>
                  </div>
                  <FieldError msg={fieldErrors.terms} />
                </div>

                <button type="submit" disabled={submitting}
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
              <span className="text-xs text-slate-600">or continue with</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.1)' }} />
            </div>

            {/* Google button — only rendered when OAuth is configured */}
            {GOOGLE_ENABLED && (
              <GoogleButton onSuccess={handleGoogleSuccess} disabled={submitting} />
            )}

            {/* Bottom links */}
            <div className="flex items-center justify-between mt-3">
              <a href={MARKETING_URL} target="_blank" rel="noreferrer"
                 className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
                ← Back to site
              </a>
              <a href={`mailto:${SALES_EMAIL}?subject=ASOS%20Demo%20Request`}
                 className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
                Contact sales →
              </a>
            </div>

            {/* Skip / demo access */}
            <div className="mt-5 text-center">
              <button type="button" onClick={handleSkip} disabled={submitting}
                      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-indigo-200 border border-indigo-400/40 bg-indigo-500/15 shadow-[0_0_24px_rgba(99,102,241,0.25)] hover:bg-indigo-500/25 hover:border-indigo-300/60 hover:text-white transition-all disabled:opacity-40">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Skip login — enter demo instantly →
              </button>
            </div>

            {/* Footer note */}
            <p className="text-center text-xs text-slate-700 mt-3">
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
            <button onClick={() => setShowForgot(false)} disabled={forgotSubmitting}
                    className="absolute top-4 right-5 text-slate-500 hover:text-slate-300 text-2xl leading-none">
              ×
            </button>
            <h3 className="text-lg font-bold text-slate-100 mb-2">Reset Password</h3>
            <p className="text-sm text-slate-400 mb-6">Enter your email and we'll send a reset link.</p>
            <form onSubmit={handleForgot} className="space-y-4">
              <AuthInput type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                         placeholder="you@company.com" required disabled={forgotSubmitting} />
              {forgotError && (
                <div className="p-3 rounded-xl text-xs leading-relaxed text-red-300"
                     style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {forgotError}
                </div>
              )}
              <button type="submit" disabled={forgotSubmitting}
                      className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                {forgotSubmitting ? 'Sending secure link…' : 'Send Reset Link →'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Post-Google phone capture modal ── */}
      {showPhoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(3,7,18,0.88)', backdropFilter: 'blur(10px)' }}>
          <div className="glass rounded-3xl p-8 w-full max-w-sm relative animate-fade-in">
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                   style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
                <span className="text-lg">📱</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Add your WhatsApp</h3>
                <p className="text-xs text-slate-500">We'll create your first lead profile</p>
              </div>
            </div>

            <p className="text-sm text-slate-400 mb-5 leading-relaxed">
              Enter your WhatsApp number to be tracked as an <span className="text-emerald-400 font-medium">organic lead</span> in your CRM. You can skip this for now.
            </p>

            {phoneModalError && (
              <div className="mb-4 p-3 rounded-xl text-xs text-red-400"
                   style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                {phoneModalError}
              </div>
            )}

            <form onSubmit={handlePhoneModalSubmit} className="space-y-4">
              <div>
                <AuthInput
                  type="tel"
                  value={phoneModalValue}
                  onChange={(e) => { setPhoneModalValue(e.target.value); setPhoneModalError(''); }}
                  placeholder="+923001234567"
                  disabled={phoneModalSubmitting}
                  autoFocus
                />
                <p className="mt-1.5 text-[10px] text-slate-600">E.164 format — include country code, no spaces</p>
              </div>

              <button
                type="submit"
                disabled={phoneModalSubmitting}
                className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-50 hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg,#10b981,#059669)', boxShadow: '0 4px 20px rgba(16,185,129,0.25)' }}
              >
                {phoneModalSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving…
                  </span>
                ) : 'Save & Continue →'}
              </button>

              <button
                type="button"
                onClick={() => navigate('/dashboard', { replace: true })}
                className="w-full py-2 text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                Skip for now
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

// ── Google button — only rendered when GOOGLE_ENABLED + inside GoogleOAuthProvider
function GoogleButton({ onSuccess, disabled }) {
  const googleLogin = useGoogleLogin({
    onSuccess,
    onError: () => {},
  });
  return (
    <button type="button" onClick={() => googleLogin()} disabled={disabled}
            className="w-full flex items-center justify-center gap-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 transition-all hover:text-white disabled:opacity-40"
            style={{ border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(15,23,42,0.6)' }}>
      <GoogleIcon />
      Continue with Google
    </button>
  );
}

// ── Google SVG icon ───────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}

// ── Reusable styled input ─────────────────────────────────────────────
function AuthInput({ className = '', error: hasError = false, ...props }) {
  const borderDefault = hasError ? 'rgba(239,68,68,0.5)'  : 'rgba(99,102,241,0.2)';
  const borderFocus   = hasError ? 'rgba(239,68,68,0.8)'  : 'rgba(99,102,241,0.6)';
  const bg            = hasError ? 'rgba(239,68,68,0.04)' : 'rgba(15,23,42,0.8)';
  return (
    <input
      className={`w-full rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all ${className}`}
      style={{ background: bg, border: `1px solid ${borderDefault}` }}
      onFocus={(e) => e.target.style.borderColor = borderFocus}
      onBlur={(e)  => e.target.style.borderColor = borderDefault}
      {...props}
    />
  );
}

// ── Field error message ───────────────────────────────────────────────
function FieldError({ msg }) {
  if (!msg) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-red-400">
      <span>⚠</span> {msg}
    </p>
  );
}
