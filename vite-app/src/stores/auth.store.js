// src/stores/auth.store.js — Zustand global auth state
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token:        null,
      refreshToken: null,
      user:         null,
      tenant:       null,

      setAuth: ({ accessToken, refreshToken, user, tenant }) => {
        set({ token: accessToken, refreshToken, user, tenant });
      },

      logout: () => {
        set({ token: null, refreshToken: null, user: null, tenant: null });
        localStorage.removeItem('asos_auth');
      },

      isAuthenticated: () => !!get().token,
      isSuperAdmin:    () => get().user?.role === 'SUPERADMIN',
      isAdmin:         () => ['SUPERADMIN', 'TENANT_ADMIN'].includes(get().user?.role),
    }),
    { name: 'asos_auth', partialize: (s) => ({ token: s.token, refreshToken: s.refreshToken, user: s.user, tenant: s.tenant }) }
  )
);
