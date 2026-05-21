// src/main.jsx — Vite app entry point
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import './index.css';

// AdminPanel is imported eagerly (not lazy) — avoids chunk-load failures on protected route
import AdminPanelPage from '@pages/AdminPanel';

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

// Pages (lazy-loaded for performance)
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

// ── Decode JWT role without a library ──────────────────────────
function getTokenRole() {
  try {
    const tok = localStorage.getItem('asos_token');
    if (!tok) return null;
    // JWT base64url → standard base64 (add padding, swap chars)
    const b64 = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '=='.slice(0, (4 - b64.length % 4) % 4);
    return JSON.parse(atob(padded)).role || null;
  } catch { return null; }
}

// ── Auth guard: must be logged in ─────────────────────────────
const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem('asos_token');
  const isValid = token && token !== 'dev-skip-token' && token.length > 20;
  if (!isValid) {
    localStorage.removeItem('asos_token');
    return <Navigate to="/auth" replace />;
  }
  return children;
};

// ── Role-aware default redirect ────────────────────────────────
// SUPERADMIN has no tenant — must land on /admin, not /dashboard
const DefaultRedirect = () => {
  const role = getTokenRole();
  return <Navigate to={role === 'SUPERADMIN' ? '/admin' : '/dashboard'} replace />;
};

// ── SuperAdmin guard: only SUPERADMIN may enter ────────────────
const SuperAdminRoute = ({ children }) => {
  const role = getTokenRole();
  if (role !== 'SUPERADMIN') return <Navigate to="/dashboard" replace />;
  return children;
};

// ── Tenant guard: block SUPERADMIN from tenant-only pages ──────
const TenantRoute = ({ children }) => {
  const role = getTokenRole();
  if (role === 'SUPERADMIN') return <Navigate to="/admin" replace />;
  return children;
};

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
      <Suspense>
        <Routes>
          {/* Auth */}
          <Route path="/auth" element={<AuthPage />} />

          {/* Protected app shell */}
          <Route path="/" element={<PrivateRoute><DashboardLayout /></PrivateRoute>}>
            {/* Role-aware default: SUPERADMIN → /admin, everyone else → /dashboard */}
            <Route index element={<DefaultRedirect />} />

            {/* Tenant-only pages — SUPERADMIN redirected to /admin */}
            <Route path="dashboard"     element={<TenantRoute><DashboardPage /></TenantRoute>}     />
            <Route path="leads"         element={<TenantRoute><PipelinePage /></TenantRoute>}      />
            <Route path="conversations" element={<TenantRoute><ConversationsPage /></TenantRoute>}  />
            <Route path="ai-insights"   element={<TenantRoute><AIInsightsPage /></TenantRoute>}    />
            <Route path="ads"           element={<TenantRoute><AdsPage /></TenantRoute>}           />
            <Route path="analytics"     element={<TenantRoute><AnalyticsPage /></TenantRoute>}     />
            <Route path="settings"      element={<TenantRoute><SettingsPage /></TenantRoute>}      />
            <Route path="billing"       element={<TenantRoute><BillingPage /></TenantRoute>}       />
            <Route path="onboarding"    element={<TenantRoute><OnboardingPage /></TenantRoute>}    />
            <Route path="students"      element={<TenantRoute><StudentsPage /></TenantRoute>}      />
            <Route path="dsp-reports"   element={<TenantRoute><DSPReportsPage /></TenantRoute>}    />
            <Route path="automations"   element={<TenantRoute><AutomationsPage /></TenantRoute>}   />

            {/* SuperAdmin only */}
            <Route path="admin" element={
              <SuperAdminRoute><AdminPanelPage /></SuperAdminRoute>
            } />
          </Route>

          {/* Catch all — role-aware */}
          <Route path="*" element={<DefaultRedirect />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </AppWithAuth>
    </ErrorBoundary>
  </React.StrictMode>
);
