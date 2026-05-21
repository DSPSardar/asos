// src/stores/auth.store.js — Zustand global auth state
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

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

      // Called once on app boot — hits /auth/me to get role from database.
      // Blocks app rendering until resolved. No JWT parsing anywhere.
      initAuth: async () => {
        const token = get().token;

        if (!token) {
          set({ ready: true });
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
