// src/stores/auth.store.js — Zustand global auth state
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

// Local, read-only preview session used by the public "Skip login" button.
// This is deliberately not a real JWT and is never sent to the API.
export const DEMO_ACCESS_TOKEN = 'asos-demo-preview-v1';
export const DEMO_USER = {
  id: 'demo-user',
  email: 'demo@asos.local',
  fullName: 'Demo User',
  role: 'TENANT_ADMIN',
};
export const DEMO_TENANT = {
  id: 'demo-tenant',
  slug: 'demo-workspace',
  name: 'ASOS Demo Workspace',
  plan: 'PRO',
  status: 'ACTIVE',
};

export const isDemoSession = () => useAuthStore.getState().token === DEMO_ACCESS_TOKEN;

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token:        null,
      refreshToken: null,
      user:         null,   // { id, email, fullName, role } — role is always server-confirmed
      tenant:       null,
      ready:        false,  // true once /auth/me has resolved (not persisted)

      setAuth: ({ accessToken, refreshToken, user, tenant }) => {
        set({ token: accessToken, refreshToken, user, tenant });
      },

      startDemo: () => {
        set({
          token: DEMO_ACCESS_TOKEN,
          refreshToken: null,
          user: DEMO_USER,
          tenant: DEMO_TENANT,
          ready: true,
        });
      },

      // Called once on app boot — hits /auth/me to get role from database.
      // Blocks app rendering until resolved. No JWT parsing anywhere.
      initAuth: async () => {
        const token = get().token;

        if (!token) {
          set({ ready: true });
          return;
        }

        // A demo preview is local by design. Do not ask the production API to
        // validate a token that is intentionally not a JWT.
        if (token === DEMO_ACCESS_TOKEN) {
          set({ user: DEMO_USER, tenant: DEMO_TENANT, refreshToken: null, ready: true });
          return;
        }

        try {
          const res = await fetch(`${BASE_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json();

          if (res.ok && json.success && json.data) {
            // Overwrite user + tenant with exactly what the database says
            set({
              user:   json.data,
              tenant: json.data.tenant ?? null,
            });
          } else {
            // Token rejected by server — clear everything
            get().logout();
          }
        } catch {
          // Network failure — keep existing state so offline usage degrades gracefully.
          // Role checks will fall back to whatever was last persisted.
        } finally {
          set({ ready: true });
        }
      },

      logout: () => {
        localStorage.removeItem('asos_token');
        localStorage.removeItem('asos_auth');
        set({ token: null, refreshToken: null, user: null, tenant: null, ready: true });
      },

      isAuthenticated: () => !!get().token,
      isSuperAdmin:    () => get().user?.role === 'SUPERADMIN',
    }),
    {
      name: 'asos_auth',
      // ready is NOT persisted — always re-validated against server on boot
      partialize: (s) => ({ token: s.token, refreshToken: s.refreshToken, user: s.user, tenant: s.tenant }),
    }
  )
);
