// src/routes.test.jsx — routing contract.
//
// Guards the restructure that made "/" public. The dashboard URL list
// below is frozen: if a path disappears, existing customers get a blank
// screen, so these tests must fail loudly rather than be updated.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './AppRoutes';
import { useAuthStore } from '@stores/auth.store';

// Replace the dashboard shell with a bare marker. Deliberately NO
// <Outlet />: without one, the 13 child pages never mount, so these
// tests stay fast and no page fires an API call into jsdom. What is
// under test is which path resolves to the authenticated shell — not
// what any individual page renders.
vi.mock('@pages/Layout', () => ({
  default: () => <div data-testid="shell" />,
}));

const DASHBOARD_PATHS = [
  '/dashboard', '/leads', '/conversations', '/ai-insights', '/ads',
  '/analytics', '/settings', '/billing', '/onboarding', '/students',
  '/dsp-reports', '/automations', '/admin',
];

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <React.Suspense fallback={<div data-testid="loading" />}>
        <AppRoutes />
      </React.Suspense>
    </MemoryRouter>
  );
}

function loginAs(role) {
  useAuthStore.setState({
    token: 'test-token',
    user: { id: 'u1', email: 'a@b.c', fullName: 'Test', role },
    tenant: { id: 't1', slug: 'test' },
    ready: true,
  });
}

describe('routing', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null, tenant: null, ready: true });
  });

  it('renders the landing page at / when logged out', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      /close deals while you sleep/i
    );
  });

  it('renders the landing page at /landing when logged out', async () => {
    renderAt('/landing');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      /close deals while you sleep/i
    );
  });

  it('redirects a logged-in tenant user from / to the dashboard', async () => {
    loginAs('TENANT_ADMIN');
    renderAt('/');
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: /close deals/i })).toBeNull();
  });

  it('sends a logged-out visitor at an unknown path to the landing page', async () => {
    renderAt('/no-such-page');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      /close deals while you sleep/i
    );
  });

  it.each(DASHBOARD_PATHS)('keeps %s behind the authenticated shell', async (path) => {
    loginAs(path === '/admin' ? 'SUPERADMIN' : 'TENANT_ADMIN');
    renderAt(path);
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it.each(DASHBOARD_PATHS)('does not expose %s to a logged-out visitor', async (path) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId('shell')).toBeNull();
  });
});
