// src/pages/AdminPanel.jsx — Superadmin: tenant approval + platform management

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { adminAPI } from '@lib/api';

// ── helpers ────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return '—';
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const STATUS_STYLE = {
  PENDING_APPROVAL: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  TRIAL:            'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  ACTIVE:           'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  SUSPENDED:        'bg-red-500/15 text-red-400 border-red-500/30',
  CANCELLED:        'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] || STATUS_STYLE.CANCELLED}`}>
      {status?.replace('_', ' ')}
    </span>
  );
}

// ── Edit Admin Modal ────────────────────────────────────────────────────────
function EditAdminModal({ tenant, onClose, onSaved, showToast }) {
  const adminUser = tenant.users?.[0];
  const [fullName, setFullName]     = useState(adminUser?.fullName || '');
  const [email, setEmail]           = useState(adminUser?.email || '');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving]         = useState(false);
  const firstInputRef = useRef(null);

  useEffect(() => {
    firstInputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {};
      if (fullName.trim())    payload.fullName    = fullName.trim();
      if (email.trim())       payload.email       = email.trim();
      if (newPassword.trim()) payload.newPassword = newPassword.trim();

      if (Object.keys(payload).length === 0) {
        showToast('No changes to save', true);
        setSaving(false);
        return;
      }

      await adminAPI.updateAdmin(tenant.id, payload);
      showToast(`✅ Admin account for "${tenant.name}" updated`);
      onSaved();
      onClose();
    } catch (err) {
      showToast(err.message || 'Update failed', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl border border-slate-700/60 bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/60 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Edit Admin Account</h2>
            <p className="mt-0.5 text-xs text-slate-500">{tenant.name} · {tenant.slug}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-surface2 hover:text-slate-200"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Full Name</label>
            <input
              ref={firstInputRef}
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Current admin name"
              className="w-full rounded-lg border border-slate-700/50 bg-surface2/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full rounded-lg border border-slate-700/50 bg-surface2/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">New Password <span className="text-slate-600">(leave blank to keep current)</span></label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full rounded-lg border border-slate-700/50 bg-surface2/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-700/50 bg-surface2/60 py-2 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete Confirmation Modal ───────────────────────────────────────────────
function DeleteModal({ tenant, onClose, onDeleted, showToast }) {
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isMatch = confirm.trim().toLowerCase() === tenant.name.trim().toLowerCase();

  const handleDelete = async () => {
    if (!isMatch) return;
    setDeleting(true);
    try {
      await adminAPI.deleteAccount(tenant.id);
      showToast(`🗑️ "${tenant.name}" and all associated data permanently deleted`);
      onDeleted();
      onClose();
    } catch (err) {
      showToast(err.message || 'Deletion failed', true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl border border-red-900/50 bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-slate-800/60 px-6 py-5">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-500/15 border border-red-500/30">
            <IconTrash className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Delete Account</h2>
            <p className="mt-1 text-sm text-slate-400">
              This will permanently delete <span className="font-medium text-slate-200">{tenant.name}</span> and all its data — users, leads, contacts, conversations, messages. <span className="text-red-400 font-medium">This cannot be undone.</span>
            </p>
          </div>
        </div>

        {/* Confirm input */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              Type <span className="font-mono text-slate-200">{tenant.name}</span> to confirm
            </label>
            <input
              autoFocus
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={tenant.name}
              className="w-full rounded-lg border border-slate-700/50 bg-surface2/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-1 focus:ring-red-500/20"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-700/50 bg-surface2/60 py-2 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={!isMatch || deleting}
              className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting ? 'Deleting…' : 'Delete Permanently'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [tenants, setTenants]   = useState([]);
  const [total, setTotal]       = useState(0);
  const [metrics, setMetrics]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('PENDING_APPROVAL');
  const [search, setSearch]     = useState('');
  const [toast, setToast]       = useState('');
  const [acting, setActing]     = useState(null);

  // Modal state
  const [editTenant, setEditTenant]     = useState(null);   // tenant object → show edit modal
  const [deleteTenant, setDeleteTenant] = useState(null);   // tenant object → show delete modal

  const showToast = (msg, isErr = false) => {
    setToast({ msg, isErr });
    setTimeout(() => setToast(''), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, metricsRes] = await Promise.all([
        adminAPI.listTenants({ status: filter || undefined, search: search || undefined, limit: 50 }),
        metrics === null ? adminAPI.metrics() : Promise.resolve(null),
      ]);
      setTenants(res.data || []);
      setTotal(res.total || 0);
      if (metricsRes) setMetrics(metricsRes.data || metricsRes);
    } catch (e) {
      showToast(e.message || 'Failed to load tenants', true);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id, name) => {
    if (!window.confirm(`Approve "${name}"? They will be able to login immediately.`)) return;
    setActing(id);
    try {
      await adminAPI.approve(id);
      showToast(`✅ "${name}" approved — account is now TRIAL`);
      load();
    } catch (e) {
      showToast(e.message || 'Approval failed', true);
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (id, name) => {
    if (!window.confirm(`Reject "${name}"? This will suspend the account.`)) return;
    setActing(id);
    try {
      await adminAPI.reject(id);
      showToast(`🚫 "${name}" rejected — account suspended`);
      load();
    } catch (e) {
      showToast(e.message || 'Rejection failed', true);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="min-h-full bg-bg p-6 space-y-6">

      {/* Modals */}
      {editTenant && (
        <EditAdminModal
          tenant={editTenant}
          onClose={() => setEditTenant(null)}
          onSaved={load}
          showToast={showToast}
        />
      )}
      {deleteTenant && (
        <DeleteModal
          tenant={deleteTenant}
          onClose={() => setDeleteTenant(null)}
          onDeleted={load}
          showToast={showToast}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-40 rounded-lg border px-4 py-3 text-sm shadow-xl animate-fade-in ${
          toast.isErr
            ? 'border-red-500/40 bg-red-500/10 text-red-300'
            : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
          <p className="mt-0.5 text-sm text-slate-400">Platform-wide tenant management — superadmin only</p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700/50 bg-surface2/60 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
        >
          <IconRefresh className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Metrics strip */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Total Tenants"   value={metrics.tenants?.total ?? '—'} />
          <MetricCard label="Active Tenants"  value={metrics.tenants?.active ?? '—'} />
          <MetricCard label="Total Leads"     value={metrics.leads?.total ?? '—'} />
          <MetricCard label="AI Messages"     value={metrics.messages?.aiHandled ?? '—'} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterChip label="⏳ Pending" value="PENDING_APPROVAL" active={filter} setFilter={setFilter} />
        <FilterChip label="🧪 Trial"   value="TRIAL"            active={filter} setFilter={setFilter} />
        <FilterChip label="✅ Active"  value="ACTIVE"           active={filter} setFilter={setFilter} />
        <FilterChip label="🚫 Suspended" value="SUSPENDED"      active={filter} setFilter={setFilter} />
        <FilterChip label="All"        value=""                 active={filter} setFilter={setFilter} />

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or slug…"
          className="ml-auto rounded-lg border border-slate-700/50 bg-surface2/60 px-3 py-1.5 text-sm placeholder-slate-500 focus:border-indigo-500/50 focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800/60 bg-surface/40">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-6 w-6 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-slate-500">
            <p className="text-lg">No tenants found</p>
            <p className="text-sm mt-1">
              {filter === 'PENDING_APPROVAL' ? 'No accounts waiting for approval right now.' : 'Try a different filter.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800/60 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Leads</th>
                <th className="px-4 py-3">Registered</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {tenants.map(t => (
                <TenantRow
                  key={t.id}
                  tenant={t}
                  acting={acting === t.id}
                  onApprove={() => handleApprove(t.id, t.name)}
                  onReject={()  => handleReject(t.id, t.name)}
                  onEdit={()    => setEditTenant(t)}
                  onDelete={()  => setDeleteTenant(t)}
                />
              ))}
            </tbody>
          </table>
        )}

        {!loading && total > tenants.length && (
          <div className="border-t border-slate-800/60 px-4 py-3 text-xs text-slate-500">
            Showing {tenants.length} of {total} tenants
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function TenantRow({ tenant, acting, onApprove, onReject, onEdit, onDelete }) {
  const adminUser = tenant.users?.[0];
  const isPending = tenant.status === 'PENDING_APPROVAL';

  return (
    <tr className="transition-colors hover:bg-surface2/30">
      <td className="px-4 py-3">
        <div className="font-medium text-slate-100">{tenant.name}</div>
        <div className="text-xs text-slate-500">{tenant.slug}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-slate-300 text-xs">{adminUser?.fullName || '—'}</div>
        <div className="text-slate-500 text-xs">{adminUser?.email || ''}</div>
      </td>
      <td className="px-4 py-3 text-slate-400">{tenant.plan}</td>
      <td className="px-4 py-3"><StatusBadge status={tenant.status} /></td>
      <td className="px-4 py-3 text-slate-400">{tenant._count?.leads ?? 0}</td>
      <td className="px-4 py-3 text-slate-400">{timeAgo(tenant.createdAt)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {isPending && (
            <>
              <button
                disabled={acting}
                onClick={onApprove}
                className="rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
              >
                {acting ? '…' : '✅ Approve'}
              </button>
              <button
                disabled={acting}
                onClick={onReject}
                className="rounded-lg bg-red-500/15 border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/25 disabled:opacity-50"
              >
                {acting ? '…' : '🚫 Reject'}
              </button>
            </>
          )}

          {/* Edit admin — always available */}
          <button
            onClick={onEdit}
            title="Edit admin account"
            className="rounded-lg border border-slate-700/50 bg-surface2/40 p-1.5 text-slate-400 transition-colors hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-300"
          >
            <IconEdit className="h-3.5 w-3.5" />
          </button>

          {/* Delete tenant — always available */}
          <button
            onClick={onDelete}
            title="Delete tenant permanently"
            className="rounded-lg border border-slate-700/50 bg-surface2/40 p-1.5 text-slate-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-800/60 bg-surface/40 p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-100">{value.toLocaleString?.() ?? value}</div>
    </div>
  );
}

function FilterChip({ label, value, active, setFilter }) {
  const isActive = active === value;
  return (
    <button
      onClick={() => setFilter(value)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        isActive
          ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-300'
          : 'border-slate-700/50 bg-surface2/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function IconRefresh(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function IconEdit(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function IconX(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
