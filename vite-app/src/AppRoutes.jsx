// src/AppRoutes.jsx — route tree, extracted out of main.jsx.
//
// Pure and side-effect-free: no ReactDOM, no './index.css', nothing runs on
// import. That is what lets routes.test.jsx import { AppRoutes } directly
// and mount it inside a MemoryRouter without also mounting the real app
// into the test's jsdom document (which main.jsx's ReactDOM.createRoot(...)
// call would do, since it targets document.getElementById('root') as a
// module-scope side effect).
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@stores/auth.store';
import { initAnalytics, trackPageView } from '@lib/analytics';

// GA4 counts one page view per document load. React Router never reloads the
// document, so without this the whole session collapses into a single view
// and every funnel step after the landing page is invisible.
function AnalyticsTracker() {
  const { pathname } = useLocation();
  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => { trackPageView(pathname); }, [pathname]);
  return null;
}

// AdminPanel is imported eagerly — no lazy chunk to fail
import AdminPanelPage from '@pages/AdminPanel';
// Landing is eager too: it is the entry point for paid traffic, so a
// lazy chunk would add a round trip before the largest paint.
import LandingPage from '@pages/Landing';

// ── Pages (lazy-loaded) ────────────────────────────────────────
const AuthPage          = React.lazy(() => import('@pages/Auth'));
const ResetPasswordPage = React.lazy(() => import('@pages/ResetPassword'));
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
const PrivacyPage       = React.lazy(() => import('@pages/Privacy'));
const TermsPage         = React.lazy(() => import('@pages/Terms'));
const NotFoundPage      = React.lazy(() => import('@pages/NotFound'));

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

// "/" is public. A visitor with no session sees the marketing page; a
// signed-in user is sent straight to their workspace.
const PublicHome = () => {
  const { token, user } = useAuthStore();
  if (!token) return <LandingPage />;
  return <Navigate to={user?.role === 'SUPERADMIN' ? '/admin' : '/dashboard'} replace />;
};

// Unknown paths render a real 404 for everyone, signed in or not.
//
// This used to redirect: anonymous visitors to "/", signed-in users to their
// workspace. Both answered a wrong URL with HTTP 200 and a valid page, which
// is a soft 404 — Google indexes the bad URL and flags it in Search Console,
// and a user who mistypes a path is silently moved without being told. The
// matching HTTP 404 status is set by the preview server; see vite.config.js.

// Exported without a Router around it so tests can mount it inside a
// MemoryRouter. The app mounts it inside BrowserRouter in main.jsx.
export function AppRoutes() {
  return (
    <>
    <AnalyticsTracker />
    <Routes>
      <Route path="/"         element={<PublicHome />} />
      <Route path="/landing"  element={<LandingPage />} />
      <Route path="/auth"     element={<AuthPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/* Public legal pages. Keep these in src/routes.manifest.js too. */}
      <Route path="/privacy"  element={<PrivacyPage />} />
      <Route path="/terms"    element={<TermsPage />} />

      {/* Pathless layout route: children keep their absolute URLs, so
          every dashboard path below is unchanged from before "/" became
          public. Do not convert these back to relative paths. */}
      <Route element={<PrivateRoute><DashboardLayout /></PrivateRoute>}>
        <Route path="/dashboard"     element={<TenantRoute><DashboardPage /></TenantRoute>}      />
        <Route path="/leads"         element={<TenantRoute><PipelinePage /></TenantRoute>}       />
        <Route path="/conversations" element={<TenantRoute><ConversationsPage /></TenantRoute>}  />
        <Route path="/ai-insights"   element={<TenantRoute><AIInsightsPage /></TenantRoute>}     />
        <Route path="/ads"           element={<TenantRoute><AdsPage /></TenantRoute>}            />
        <Route path="/analytics"     element={<TenantRoute><AnalyticsPage /></TenantRoute>}      />
        <Route path="/settings"      element={<TenantRoute><SettingsPage /></TenantRoute>}       />
        <Route path="/billing"       element={<TenantRoute><BillingPage /></TenantRoute>}        />
        <Route path="/onboarding"    element={<TenantRoute><OnboardingPage /></TenantRoute>}     />
        <Route path="/students"      element={<TenantRoute><StudentsPage /></TenantRoute>}       />
        <Route path="/dsp-reports"   element={<TenantRoute><DSPReportsPage /></TenantRoute>}     />
        <Route path="/automations"   element={<TenantRoute><AutomationsPage /></TenantRoute>}    />

        {/* SUPERADMIN only */}
        <Route path="/admin" element={<SuperAdminRoute><AdminPanelPage /></SuperAdminRoute>} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </>
  );
}
