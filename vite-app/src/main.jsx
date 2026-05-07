// src/main.jsx — Vite app entry point
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import './index.css';

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
const AuthPage       = React.lazy(() => import('@pages/Auth'));
const DashboardLayout= React.lazy(() => import('@pages/Layout'));
const DashboardPage  = React.lazy(() => import('@pages/Dashboard'));
const PipelinePage   = React.lazy(() => import('@pages/Pipeline'));
const ConversationsPage= React.lazy(() => import('@pages/Conversations'));
const AIInsightsPage = React.lazy(() => import('@pages/AIInsights'));
const AdsPage        = React.lazy(() => import('@pages/AdsPerformance'));
const AnalyticsPage  = React.lazy(() => import('@pages/Analytics'));
const SettingsPage   = React.lazy(() => import('@pages/Settings'));
const BillingPage    = React.lazy(() => import('@pages/Billing'));
const OnboardingPage = React.lazy(() => import('@pages/Onboarding'));
const StudentsPage   = React.lazy(() => import('@pages/Students'));
const DSPReportsPage = React.lazy(() => import('@pages/DSPReports'));
const AutomationsPage= React.lazy(() => import('@pages/Automations'));

// ── Auth guard ────────────────────────────────────────────────
const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem('asos_token');
  const isValid = token && token !== 'dev-skip-token' && token.length > 20;
  if (!isValid) {
    localStorage.removeItem('asos_token');
    return <Navigate to="/auth" replace />;
  }
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

// Wrap with GoogleOAuthProvider only if a client ID is configured
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

          {/* Protected dashboard */}
          <Route path="/" element={<PrivateRoute><DashboardLayout /></PrivateRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard"     element={<DashboardPage />}    />
            <Route path="leads"         element={<PipelinePage />}     />
            <Route path="conversations" element={<ConversationsPage />} />
            <Route path="ai-insights"   element={<AIInsightsPage />}   />
            <Route path="ads"           element={<AdsPage />}          />
            <Route path="analytics"     element={<AnalyticsPage />}    />
            <Route path="settings"      element={<SettingsPage />}     />
            <Route path="billing"       element={<BillingPage />}      />
            <Route path="onboarding"    element={<OnboardingPage />}   />
            <Route path="students"      element={<StudentsPage />}     />
            <Route path="dsp-reports"   element={<DSPReportsPage />}   />
            <Route path="automations"   element={<AutomationsPage />}  />
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </AppWithAuth>
    </ErrorBoundary>
  </React.StrictMode>
);
