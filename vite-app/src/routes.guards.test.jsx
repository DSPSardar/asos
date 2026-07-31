// src/routes.guards.test.jsx — route *guard* contract.
//
// Separate from routes.test.jsx on purpose. That file mocks @pages/Layout
// as a bare marker with NO <Outlet />, which is correct for what it tests
// (which paths resolve to the authenticated shell) but means nothing
// nested inside the layout route — TenantRoute, SuperAdminRoute — ever
// mounts. vi.mock is file-scoped, so the only way to exercise those
// guards is a second file with its own Layout mock that DOES render
// <Outlet />. This file exercises the guards *inside* the layout; the
// other file exercises which paths resolve *to* it. Do not merge them:
// doing so would either reintroduce real page components mounting in
// jsdom (firing API calls) or lose coverage of one of the two concerns.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from './AppRoutes';
import { useAuthStore } from '@stores/auth.store';

vi.mock('@pages/Layout', async () => {
  const { Outlet } = await vi.importActual('react-router-dom');
  return { default: () => <div data-testid="shell"><Outlet /></div> };
});
vi.mock('@pages/AdminPanel', () => ({ default: () => <div data-testid="admin-panel" /> }));
vi.mock('@pages/Pipeline', () => ({ default: () => <div data-testid="leads-page" /> }));

// Reports the location AFTER any redirect chain has settled. Without this,
// a dropped guard could silently redirect to a different path and the
// marker assertions alone would not catch it.
function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <React.Suspense fallback={<div data-testid="loading" />}>
        <AppRoutes />
      </React.Suspense>
      <LocationProbe />
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

describe('route guards', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null, tenant: null, ready: true });
  });

  it('blocks a TENANT_ADMIN from /admin (SuperAdminRoute)', async () => {
    loginAs('TENANT_ADMIN');
    renderAt('/admin');
    // The shell renders at both /admin and /dashboard (both nested under the
    // layout route), so waiting for the shell alone can resolve before the
    // <Navigate> redirect effect has actually fired. Wait for the pathname
    // to settle instead.
    await waitFor(() => {
      expect(screen.getByTestId('pathname').textContent).toBe('/dashboard');
    });
    expect(screen.queryByTestId('admin-panel')).toBeNull();
  });

  it('allows a SUPERADMIN into /admin (SuperAdminRoute)', async () => {
    loginAs('SUPERADMIN');
    renderAt('/admin');
    expect(await screen.findByTestId('admin-panel')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/admin');
  });

  it('blocks a SUPERADMIN from /leads (TenantRoute)', async () => {
    loginAs('SUPERADMIN');
    renderAt('/leads');
    // Same rationale as the /admin block test above: wait for the pathname
    // to settle, not just for the shell to appear.
    await waitFor(() => {
      expect(screen.getByTestId('pathname').textContent).toBe('/admin');
    });
    expect(screen.queryByTestId('leads-page')).toBeNull();
  });

  it('allows a TENANT_ADMIN into /leads (TenantRoute)', async () => {
    loginAs('TENANT_ADMIN');
    renderAt('/leads');
    expect(await screen.findByTestId('leads-page')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/leads');
  });
});
