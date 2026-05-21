// src/main.jsx — Vite app entry point
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useAuthStore } from '@stores/auth.store';
import './index.css';

// AdminPanel is imported eagerly — no lazy chunk to fail
import AdminPanelPage from '@pages/AdminPanel';

// ── Error boundary ─────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
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

// ── Pages (lazy-loaded) ────────────────────────────────────────
const AuthPage          = React.lazy(() => import('@pages/Auth'));
const DashboardLayout   = React.lazy(() => import('@pages/Layout'));
const DashboardPage     = React.lazy(() => import('@pages/Dashboard'));
const PipelinePage      = React.lazy(() => import('@pages/Pipeline'));
const ConversationsPage = React.lazy(() => import('@pages/Conversations'));
const AIInsightsPage    = React.lazy(() => import('@pages/AIInsights'));
const AdsPage           = React.lazy(() => import('@pages/AdsPerformance'));
const AnalyticsPage     = React.lazy(() => import('@pages/Analytics'));
const SettingsPage      = React.lazy(() => import('@pages/Settings'));
const BillingPage       = React.lazy(() => import('@pages/Billing'));
const OnboardingPage    = React.lazy(() => import('@pages/Onboarding'));
const StudentsPage      = React.lazy(() => import('@pages/Students'));
const DSPReportsPage    = React.lazy(() => import('@pages/DSPReports'));
const AutomationsPage   = React.lazy(() => import('@pages/Automations'));

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

  return children;
}

// ── Route guards — all use Zustand user.role (server-confirmed) ─
const PrivateRoute = ({ children }) => {
  const { token } = useAuthStore();
  if (!token) return <Navigate to="/auth" replace />;
  return children;
};

// Sends user to the correct landing page based on server-confirmed role
const DefaultRedirect = () => {
  const { user } = useAuthStore();
  return <Navigate to={user?.role === 'SUPERADMIN' ? '/admin' : '/dashboard'} replace />;
};

// Only SUPERADMIN may access this route
const SuperAdminRoute = ({ children }) => {
  const { user } = useAuthStore();
  if (user?.role !== 'SUPERADMIN') return <Navigate to="/dashboard" replace />;
  return children;
};

// Tenant-only routes — SUPERADMIN is redirected away (has no tenant)
const TenantRoute = ({ children }) => {
  const { user } = useAuthStore();
  if (user?.role === 'SUPERADMIN') return <Navigate to="/admin" replace />;
  return children;
};

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
          <Routes>
            <Route path="/auth" element={<AuthPage />} />

            <Route path="/" element={<PrivateRoute><DashboardLayout /></PrivateRoute>}>
              <Route index element={<DefaultRedirect />} />

              {/* Tenant pages — SUPERADMIN cannot enter */}
              <Route path="dashboard"     element={<TenantRoute><DashboardPage /></TenantRoute>}      />
              <Route path="leads"         element={<TenantRoute><PipelinePage /></TenantRoute>}       />
              <Route path="conversations" element={<TenantRoute><ConversationsPage /></TenantRoute>}  />
              <Route path="ai-insights"   element={<TenantRoute><AIInsightsPage /></TenantRoute>}     />
              <Route path="ads"           element={<TenantRoute><AdsPage /></TenantRoute>}            />
              <Route path="analytics"     element={<TenantRoute><AnalyticsPage /></TenantRoute>}      />
              <Route path="settings"      element={<TenantRoute><SettingsPage /></TenantRoute>}       />
              <Route path="billing"       element={<TenantRoute><BillingPage /></TenantRoute>}        />
              <Route path="onboarding"    element={<TenantRoute><OnboardingPage /></TenantRoute>}     />
              <Route path="students"      element={<TenantRoute><StudentsPage /></TenantRoute>}       />
              <Route path="dsp-reports"   element={<TenantRoute><DSPReportsPage /></TenantRoute>}     />
              <Route path="automations"   element={<TenantRoute><AutomationsPage /></TenantRoute>}    />

              {/* SUPERADMIN only */}
              <Route path="admin" element={<SuperAdminRoute><AdminPanelPage /></SuperAdminRoute>} />
            </Route>

            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </Suspense>
      </AuthInitializer>
    </BrowserRouter>
    </AppWithAuth>
    </ErrorBoundary>
  </React.StrictMode>
);
