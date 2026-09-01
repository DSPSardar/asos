// src/lib/api.js — Production Axios API client for Vite app
import axios from 'axios';
import { isDemoSession, useAuthStore } from '@stores/auth.store';

// The dashboard and API are both deployed on Railway. Use the public API
// directly so the dashboard has no dependency on a Vercel proxy.
// VITE_API_URL lets this point at a custom domain without a code change —
// falls back to the Railway URL when unset (Vite env vars are build-time,
// so a new value takes effect on the next build, not at runtime).
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://asos-production.up.railway.app/api/v1';
const BASE_URL = API_BASE_URL;

/**
 * Public WhatsApp webhook URL shown in Settings.
 *
 * Prefer an explicit value when the public webhook hostname differs from the
 * dashboard. Otherwise derive it from the configured API URL.
 */
export function resolveWhatsAppWebhookUrl() {
  const explicit = String(import.meta.env.VITE_WHATSAPP_WEBHOOK_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  if (/^https?:\/\//i.test(API_BASE_URL)) {
    const apiOrigin = API_BASE_URL.replace(/\/api\/v1\/?$/i, '');
    return `${apiOrigin}/webhooks/whatsapp`;
  }

  if (typeof window !== 'undefined') return `${window.location.origin}/webhooks/whatsapp`;
  return '/webhooks/whatsapp';
}

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

const previewDataFor = (url = '') => {
  const path = String(url).split('?')[0];

  if (path === '/leads/hot' || path === '/leads/handoff' || path === '/leads') return [];
  if (path === '/users' || path.startsWith('/conversations') || path.startsWith('/campaigns')) return [];
  if (path === '/reports' || path === '/billing/invoices' || path.includes('/drafts')) return [];
  if (path === '/settings') return { name: 'ASOS Demo Workspace', mockMode: true };
  if (path === '/ai/knowledge-gaps') return { gaps: [] };

  // Returning null lets pages keep their built-in chart/demo constants.
  return null;
};

const previewAdapter = async (config) => {
  if (String(config.method || 'get').toLowerCase() !== 'get') {
    const message = 'Demo preview is read-only. Create an account to save changes.';
    const error = new Error(message);
    error.config = config;
    error.response = { status: 403, data: { message }, config, headers: {} };
    throw error;
  }

  return {
    data: { success: true, data: previewDataFor(config.url) },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
    request: null,
  };
};

// ── Request interceptor — attach JWT ─────────────────────────
api.interceptors.request.use((config) => {
  if (isDemoSession()) {
    config.adapter = previewAdapter;
    delete config.headers.Authorization;
    return config;
  }

  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // This instance sets a default Content-Type of application/json, which would
  // override the multipart type a FormData body needs — and multipart is
  // useless without the boundary parameter the browser generates. Clearing the
  // header lets the browser set both. Without this, file uploads reach the
  // server as unparseable JSON and multer sees no file.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
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
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword:  (token, password) => api.post('/auth/reset-password', { token, password }),
  googleAuth: (credential) => api.post('/auth/google', { credential }),
  savePhone:  (phone) => api.post('/auth/phone', { phone }),
  refresh:    (refreshToken) => api.post('/auth/refresh', { refreshToken }),
  logout:         () => api.post('/auth/logout'),
  me:             () => api.get('/auth/me'),
  changePassword: (newPassword) => api.post('/auth/change-password', { newPassword }),
  changeEmail:    (newEmail, currentPassword) => api.post('/auth/change-email', { newEmail, currentPassword }),
};

export const insightsAPI = {
  sentiment: () => api.get('/insights/sentiment'),
  signals:   (limit = 20) => api.get('/insights/signals', { params: { limit } }),
  digest:    () => api.get('/insights/digest'),
};

export const leadsAPI = {
  list:        (params) => api.get('/leads', { params }),
  pipeline:    (params) => api.get('/leads/pipeline', { params: params || {} }),
  hot:         (limit = 20) => api.get('/leads/hot', { params: { limit } }),
  handoff:     () => api.get('/leads/handoff'),
  get:         (id) => api.get(`/leads/${id}`),
  create:      (data) => api.post('/leads', data),
  updateStage: (id, stage, lostReason, fee, currency) => api.patch(`/leads/${id}/stage`, { stage, lostReason, fee, currency }),
  assign:      (id, agentId) => api.patch(`/leads/${id}/assign`, { agentId }),
  importStudents: (students) => api.post('/leads/import-students', { students }),
  addNote:     (id, content) => api.post(`/leads/${id}/notes`, { content }),
  updateDeal:  (id, dealValue, currency) => api.patch(`/leads/${id}/deal-value`, { dealValue, currency }),
  // No argument previews; confirm:true performs the import.
  syncDsp:     (confirm = false) => api.post('/leads/sync-dsp', { confirm }),
  deleteLead:  (id) => api.delete(`/leads/${id}`),
};

export const automationsAPI = {
  list:    () => api.get('/automations'),
  runs:    (ruleId, limit = 50) => api.get(ruleId ? `/automations/${ruleId}/runs` : '/automations/runs', { params: { limit } }),
  create:  (data) => api.post('/automations', data),
  update:  (id, data) => api.patch(`/automations/${id}`, data),
  toggle:  (id, enabled) => api.patch(`/automations/${id}/toggle`, { enabled }),
  remove:  (id) => api.delete(`/automations/${id}`),
  preview: (id) => api.post(`/automations/${id}/preview`),
};

// Today's Queue (backend modules/today). Draft/summary are POST because they
// may spend AI tokens — once per thread state, cached server-side.
export const todayAPI = {
  queue:        (all = false) => api.get('/today', { params: all ? { all: '1' } : {} }),
  templates:    () => api.get('/today/templates'),
  context:      (id) => api.get(`/today/${id}/context`),
  draft:        (id, force = false) => api.post(`/today/${id}/draft`, { force }),
  summary:      (id, force = false) => api.post(`/today/${id}/summary`, { force }),
  send:         (id, content) => api.post(`/today/${id}/send`, { content }),
  sendTemplate: (id, name) => api.post(`/today/${id}/send-template`, { name }),
  skip:         (id) => api.post(`/today/${id}/skip`),
  unskip:       (id) => api.delete(`/today/${id}/skip`),
  dismiss:      (id) => api.post(`/today/${id}/dismiss`),
  undismiss:    (id) => api.delete(`/today/${id}/dismiss`),
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
  confirmPayment: (id, fee, currency) => api.post(`/conversations/${id}/confirm-payment`, { fee, currency }),
  summary:    (id) => api.get(`/conversations/${id}/summary`),
  clearMessages:      (id) => api.delete(`/conversations/${id}/messages`),
  deleteConversation: (id) => api.delete(`/conversations/${id}`),
};

export const campaignsAPI = {
  list:    () => api.get('/campaigns'),
  get:     (id) => api.get(`/campaigns/${id}`),
  create:  (data) => api.post('/campaigns', data),
  update:  (id, data) => api.patch(`/campaigns/${id}`, data),
  delete:  (id) => api.delete(`/campaigns/${id}`),
  launch:  (data) => api.post('/campaigns/launch', data),
  sync:    (id) => api.post(`/campaigns/${id}/sync`),
  roi:     (id) => api.get(`/campaigns/${id}/roi`),
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
  sources:       (params) => api.get('/analytics/sources', { params }),
  conversions:   (params) => api.get('/analytics/conversions', { params }),
  hotByHour:     () => api.get('/analytics/hot-by-hour'),
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

  // Bank transfer + screenshot. Stripe cannot take payments for a Pakistani
  // business, so this — not checkout() above — is the live billing path.
  // FormData on purpose: the proof is a file upload. Do NOT set Content-Type
  // by hand; the browser must add the multipart boundary itself.
  submitManualPayment: (formData) =>
    api.post('/billing/manual-payments', formData),
  listManualPayments:  () => api.get('/billing/manual-payments'),
};

export const aiConfigAPI = {
  get:    () => api.get('/ai/config'),
  update: (data) => api.put('/ai/config', data),
  test:   (message) => api.post('/ai/config/test', { message }),
  usage:  () => api.get('/ai/usage'),
  uploadWelcomeVoice: (formData) => api.post('/ai/config/welcome-voice', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
};

export const knowledgeGapsAPI = {
  list:   (params) => api.get('/ai/knowledge-gaps', { params }),
  answer: (id, answer) => api.patch(`/ai/knowledge-gaps/${id}`, { answer }),
  delete: (id) => api.delete(`/ai/knowledge-gaps/${id}`),
};

export const settingsAPI = {
  get:             () => api.get('/settings'),
  update:          (data) => api.put('/settings', data),
  updateWA:        (data) => api.put('/settings/whatsapp', data),
  verifyWA:        () => api.post('/settings/whatsapp/verify'),
  testWA:          (testPhone) => api.post('/settings/whatsapp/test', { testPhone }),
  updateMeta:      (data) => api.put('/settings/meta', data),
  verifyMetaAds:   () => api.post('/settings/meta/verify'),
  testMetaAds:     () => api.post('/settings/meta/test'),
  getSheets:        () => api.get('/settings/sheets'),
  connectSheets:    (sheetUrl) => api.post('/settings/sheets/connect', { sheetUrl }),
  disconnectSheets: () => api.post('/settings/sheets/disconnect'),
  syncSheets:       () => api.post('/settings/sheets/sync'),
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
  updateAdmin: (id, data) => api.put(`/admin/tenants/${id}/admin`, data),
  deleteAccount:(id)    => api.delete(`/admin/tenants/${id}`),
  metrics:     ()       => api.get('/admin/metrics'),

  // Bank-transfer payment review. approve() is what activates the plan and
  // sets its expiry — see backend manualPayment.service.js.
  listManualPayments: (params) => api.get('/admin/manual-payments', { params }),
  approveManualPayment: (id) => api.post(`/admin/manual-payments/${id}/approve`),
  rejectManualPayment:  (id, reviewNote) => api.post(`/admin/manual-payments/${id}/reject`, { reviewNote }),
  // Path only — rendered in an <img>, which cannot carry the auth header, so
  // AdminPanel fetches it as a blob through the authorised axios instance.
  manualPaymentProofPath: (id) => `/admin/manual-payments/${id}/proof`,
};
