// src/lib/api.js — Production Axios API client for Vite app
import axios from 'axios';
import { useAuthStore } from '@stores/auth.store';

const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

/** API origin for static `/uploads/*` (set in production when SPA host ≠ API host). */
const UPLOADS_ORIGIN = String(import.meta.env.VITE_UPLOADS_ORIGIN || '').trim().replace(/\/+$/, '');

/** Build absolute URL for paths like `/uploads/...` (served by API, not SPA host). */
export function resolveUploadUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  const s = String(pathOrUrl).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const rel = s.startsWith('/') ? s : `/${s}`;
  if (UPLOADS_ORIGIN) return `${UPLOADS_ORIGIN}${rel}`;
  const origin = String(BASE_URL).replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');
  if (origin) return `${origin}${rel}`;
  if (typeof window !== 'undefined') return `${window.location.origin}${rel}`;
  return rel;
}

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor — attach JWT ─────────────────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response interceptor — auto refresh + error handling ─────
api.interceptors.response.use(
  (res) => res.data,
  async (err) => {
    const original = err.config;

    // Auto-refresh on 401
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = useAuthStore.getState().refreshToken;

      if (refreshToken) {
        try {
          const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
          const { accessToken } = res.data.data;
          useAuthStore.getState().setAuth({ accessToken, refreshToken, user: useAuthStore.getState().user, tenant: useAuthStore.getState().tenant });
          original.headers.Authorization = `Bearer ${accessToken}`;
          return api(original);
        } catch {
          useAuthStore.getState().logout();
          window.location.href = '/auth';
        }
      } else {
        useAuthStore.getState().logout();
        window.location.href = '/auth';
      }
    }

    // Format error
    const message = err.response?.data?.message || err.message || 'Request failed';
    return Promise.reject(new Error(message));
  }
);

// ── Typed API calls ───────────────────────────────────────────

export const authAPI = {
  login:      (data) => api.post('/auth/login', data),
  register:   (data) => api.post('/auth/register', data),
  googleAuth: (credential) => api.post('/auth/google', { credential }),
  savePhone:  (phone) => api.post('/auth/phone', { phone }),
  refresh:    (refreshToken) => api.post('/auth/refresh', { refreshToken }),
  logout:         () => api.post('/auth/logout'),
  me:             () => api.get('/auth/me'),
  changePassword: (newPassword) => api.post('/auth/change-password', { newPassword }),
  changeEmail:    (newEmail, currentPassword) => api.post('/auth/change-email', { newEmail, currentPassword }),
};

export const leadsAPI = {
  list:        (params) => api.get('/leads', { params }),
  pipeline:    (params) => api.get('/leads/pipeline', { params: params || {} }),
  hot:         (limit = 20) => api.get('/leads/hot', { params: { limit } }),
  handoff:     () => api.get('/leads/handoff'),
  get:         (id) => api.get(`/leads/${id}`),
  create:      (data) => api.post('/leads', data),
  updateStage: (id, stage, lostReason) => api.patch(`/leads/${id}/stage`, { stage, lostReason }),
  assign:      (id, agentId) => api.patch(`/leads/${id}/assign`, { agentId }),
  addNote:     (id, content) => api.post(`/leads/${id}/notes`, { content }),
  updateDeal:  (id, dealValue, currency) => api.patch(`/leads/${id}/deal-value`, { dealValue, currency }),
  syncDsp:     () => api.post('/leads/sync-dsp'),
  deleteLead:  (id) => api.delete(`/leads/${id}`),
};

export const contactsAPI = {
  list:   (params) => api.get('/contacts', { params }),
  get:    (id) => api.get(`/contacts/${id}`),
  create: (data) => api.post('/contacts', data),
  update: (id, data) => api.patch(`/contacts/${id}`, data),
  delete: (id) => api.delete(`/contacts/${id}`),
};

export const conversationsAPI = {
  list:       (params) => api.get('/conversations', { params }),
  byClient:   (clientId) => api.get(`/conversations/client/${clientId}`),
  get:        (id) => api.get(`/conversations/${id}`),
  sendMessage:(id, content) => api.post(`/conversations/${id}/messages`, { content }),
  suggestion: (id) => api.get(`/conversations/${id}/suggestion`),
  toggleAI:   (id, aiEnabled) => api.patch(`/conversations/${id}/ai`, { aiEnabled }),
  takeover:   (id) => api.post(`/conversations/${id}/takeover`),
  handback:   (id) => api.post(`/conversations/${id}/handback`),
  close:      (id) => api.post(`/conversations/${id}/close`),
  summary:    (id) => api.get(`/conversations/${id}/summary`),
  clearMessages:      (id) => api.delete(`/conversations/${id}/messages`),
  deleteConversation: (id) => api.delete(`/conversations/${id}`),
};

export const campaignsAPI = {
  list:   () => api.get('/campaigns'),
  get:    (id) => api.get(`/campaigns/${id}`),
  create: (data) => api.post('/campaigns', data),
  update: (id, data) => api.patch(`/campaigns/${id}`, data),
  sync:   (id) => api.post(`/campaigns/${id}/sync`),
  roi:    (id) => api.get(`/campaigns/${id}/roi`),
  underperforming: () => api.get('/campaigns/underperforming/list'),
  recommendations: (id) => api.get(`/campaigns/${id}/recommendations`),
};

export const analyticsAPI = {
  overview:      (params) => api.get('/analytics/overview', { params }),
  funnel:        (params) => api.get('/analytics/funnel', { params }),
  revenue:       (params) => api.get('/analytics/revenue', { params }),
  aiPerformance: (params) => api.get('/analytics/ai-performance', { params }),
  agents:        (params) => api.get('/analytics/agents', { params }),
  messages:      (params) => api.get('/analytics/messages', { params }),
  teamPerformance: (params) => api.get('/analytics/team-performance', { params }),
};

export const contentStudioAPI = {
  extract: (data) => api.post('/content-studio/extract', data),
  generate: (data) => api.post('/content-studio/generate', data),
  image: (prompt) => api.post('/content-studio/image', { prompt }, { timeout: 120000 }),
  draftImage: (id, prompt) =>
    api.post(`/content-studio/drafts/${id}/image`, prompt ? { prompt } : {}, { timeout: 120000 }),
  listSavedDrafts: (limit = 50) => api.get('/content-studio/drafts', { params: { limit } }),
  /** Authenticated image bytes — works when public /uploads is not proxied */
  getDraftImageFile: (id) =>
    api.get(`/content-studio/drafts/${id}/image-file`, { responseType: 'blob', timeout: 60000 }),
  updateDraft: (id, data) => api.patch(`/content-studio/drafts/${id}`, data),
  publish: (id) => api.post(`/content-studio/drafts/${id}/publish`),
  sendApproval: (id, phone) => api.post(`/content-studio/drafts/${id}/send-approval`, { phone }),
};

export const reportsAPI = {
  list: () => api.get('/reports'),
  generate: (data) => api.post('/reports/generate', data),
};

export const billingAPI = {
  subscription: () => api.get('/billing/subscription'),
  checkout:     (plan) => api.post('/billing/checkout', { plan }),
  portal:       () => api.post('/billing/portal'),
  invoices:     () => api.get('/billing/invoices'),
  cancel:       () => api.post('/billing/cancel'),
};

export const aiConfigAPI = {
  get:    () => api.get('/ai/config'),
  update: (data) => api.put('/ai/config', data),
  test:   (message) => api.post('/ai/config/test', { message }),
  usage:  () => api.get('/ai/usage'),
};

export const knowledgeGapsAPI = {
  list:   (params) => api.get('/ai/knowledge-gaps', { params }),
  answer: (id, answer) => api.patch(`/ai/knowledge-gaps/${id}`, { answer }),
  delete: (id) => api.delete(`/ai/knowledge-gaps/${id}`),
};

export const settingsAPI = {
  get:          () => api.get('/settings'),
  update:       (data) => api.put('/settings', data),
  updateWA:     (data) => api.put('/settings/whatsapp', data),
  verifyWA:     () => api.post('/settings/whatsapp/verify'),
  testWA:       (testPhone) => api.post('/settings/whatsapp/test', { testPhone }),
  updateMeta:   (data) => api.put('/settings/meta', data),
};

export const usersAPI = {
  list:   () => api.get('/users'),
  invite: (data) => api.post('/users/invite', data),
  update: (id, role) => api.patch(`/users/${id}/role`, { role }),
  remove: (id) => api.delete(`/users/${id}`),
  me:     () => api.get('/users/me'),
};

// Dev-only (available when WHATSAPP_MOCK=true)
export const devAPI = {
  tenants:       () => api.get('/dev/tenants'),
  injectMessage: (data) => api.post('/dev/inject-message', data),
};

// Superadmin — platform management
export const adminAPI = {
  listTenants: (params) => api.get('/admin/tenants', { params }),
  getTenant:   (id)     => api.get(`/admin/tenants/${id}`),
  updateTenant:(id, data) => api.patch(`/admin/tenants/${id}`, data),
  approve:     (id)     => api.post(`/admin/tenants/${id}/approve`),
  reject:      (id)     => api.post(`/admin/tenants/${id}/reject`),
  metrics:     ()       => api.get('/admin/metrics'),
};
