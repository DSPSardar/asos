import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI } from '@lib/api';

const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || 'ASOS';

function PasswordInput({ label, value, onChange, visible, onToggle, autoComplete }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required
          minLength={8}
          maxLength={128}
          className="w-full rounded-xl px-4 py-3 pr-12 text-sm text-slate-100 outline-none transition-all focus:ring-2 focus:ring-indigo-500/40"
          style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(99,102,241,0.2)' }}
          placeholder="At least 8 characters"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  );
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token] = useState(() => params.get('token') || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  // Remove the secret token from browser history after capturing it in memory.
  useEffect(() => {
    if (token) navigate('/reset-password', { replace: true });
  }, [navigate, token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError('');

    if (password.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await authAPI.resetPassword(token, password);
      setComplete(true);
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err?.message || 'Could not reset your password. Request a new link and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const invalidLink = !token;

  return (
    <div className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden" style={{ background: '#030712' }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(99,102,241,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.04) 1px,transparent 1px)',
        backgroundSize: '56px 56px',
      }} />
      <div className="absolute top-0 left-1/3 w-96 h-96 rounded-full opacity-20 pointer-events-none"
           style={{ background: 'radial-gradient(circle,#6366f1,transparent 70%)', filter: 'blur(90px)' }} />

      <main className="glass relative w-full max-w-md rounded-3xl p-8 sm:p-10"
            style={{ border: '1px solid rgba(99,102,241,0.18)' }}>
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold"
               style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>A</div>
          <div>
            <div className="font-bold text-white">{BRAND_NAME}</div>
            <div className="text-[10px] text-indigo-400 tracking-widest font-mono">SECURE PASSWORD RESET</div>
          </div>
        </div>

        {complete ? (
          <div>
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl mb-5"
                 style={{ background: 'rgba(16,185,129,0.12)', color: '#34d399' }}>✓</div>
            <h1 className="text-2xl font-bold text-white mb-2">Password updated</h1>
            <p className="text-sm text-slate-400 leading-relaxed mb-7">
              Your password has been changed and previous refresh sessions were signed out.
            </p>
            <Link to="/auth" className="block w-full text-center rounded-xl py-3 text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              Sign in with new password →
            </Link>
          </div>
        ) : invalidLink ? (
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Reset link unavailable</h1>
            <p className="text-sm text-slate-400 leading-relaxed mb-7">
              This link is incomplete. Request a new password-reset email from the sign-in page.
            </p>
            <Link to="/auth?forgot=1" className="block w-full text-center rounded-xl py-3 text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              Request a new link →
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-white mb-2">Choose a new password</h1>
            <p className="text-sm text-slate-400 leading-relaxed mb-7">
              Enter a new password for your ASOS account. This link can only be used once.
            </p>

            {error && (
              <div className="mb-5 p-3 rounded-xl text-sm text-red-300"
                   style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <PasswordInput
                label="New password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                visible={visible}
                onToggle={() => setVisible((value) => !value)}
                autoComplete="new-password"
              />
              <PasswordInput
                label="Confirm new password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                visible={visible}
                onToggle={() => setVisible((value) => !value)}
                autoComplete="new-password"
              />
              <button type="submit" disabled={submitting}
                      className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                {submitting ? 'Updating password…' : 'Update password →'}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
