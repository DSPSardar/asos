// src/main.jsx — Vite app entry point

// Imported first, before React or anything that could render, so Sentry is
// listening before the app does anything that might throw. See
// src/instrument.js.
import Sentry from './instrument';

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useAuthStore } from '@stores/auth.store';
// '@/hooks/...' — there is no '@hooks' alias in vite.config.js, and importing
// through one breaks the build.
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { AppRoutes } from './AppRoutes';
import './index.css';

// ── Error boundary ─────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  // Reports to Sentry in addition to rendering the fallback below — a
  // render-time error here would otherwise be visible only as a blank
  // screen a user complains about, with nothing in any log to explain it.
  componentDidCatch(error, info) {
    Sentry.captureException(error, { extra: { componentStack: info?.componentStack } });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight:'100vh', background:'#030712', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16, color:'#f1f5f9', fontFamily:'sans-serif', padding:24 }}>
          <div style={{ fontSize:32 }}>⚠</div>
          <div style={{ fontSize:16, fontWeight:600 }}>Something went wrong</div>
          <div style={{ fontSize:12, color:'#64748b', maxWidth:400, textAlign:'center' }}>{this.state.error.message}</div>
          <button onClick={() => window.location.reload()} style={{ marginTop:8, padding:'8px 20px', borderRadius:8, background:'#6366f1', color:'#fff', border:'none', cursor:'pointer', fontSize:13 }}>Reload page</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── WebSocket Initializer — connects to real-time sync ─────────
function WebSocketInitializer({ children }) {
  useRealtimeSync();
  return children;
}

// ── App initializer — calls /auth/me on boot ───────────────────
// Blocks ALL rendering until the server confirms the user's role.
// No JWT parsing. No localStorage role sniffing. Database is the source of truth.
function AuthInitializer({ children }) {
  const { ready, initAuth } = useAuthStore();

  useEffect(() => {
    initAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return (
      <div style={{ minHeight:'100vh', background:'#030712', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:32, height:32, border:'2px solid rgba(99,102,241,0.3)', borderTopColor:'#6366f1', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <WebSocketInitializer>{children}</WebSocketInitializer>;
}

// ── Suspense wrapper ───────────────────────────────────────────
const Suspense = ({ children }) => (
  <React.Suspense fallback={
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
    </div>
  }>
    {children}
  </React.Suspense>
);

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const AppWithAuth = ({ children }) => GOOGLE_CLIENT_ID
  ? <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{children}</GoogleOAuthProvider>
  : <>{children}</>;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
    <AppWithAuth>
    <BrowserRouter>
      {/* AuthInitializer hits /auth/me before rendering anything */}
      <AuthInitializer>
        <Suspense>
          <AppRoutes />
        </Suspense>
      </AuthInitializer>
    </BrowserRouter>
    </AppWithAuth>
    </ErrorBoundary>
  </React.StrictMode>
);
