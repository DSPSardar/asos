// src/main.jsx — Vite app entry point
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import './index.css';

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
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
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
