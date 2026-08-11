// src/components/admin/ManualPaymentsQueue.jsx
//
// Superadmin review of bank-transfer payments. Approving here is what actually
// activates a client's plan and sets its expiry date — it is not a bookkeeping
// note. Check the amount and reference against the bank statement before
// approving; the screenshot alone is trivially faked.
import React, { useEffect, useState } from 'react';
import { adminAPI, api } from '@lib/api';

const STATUS_STYLES = {
  PENDING:  'border-amber-500/30 bg-amber-500/10 text-amber-300',
  APPROVED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  REJECTED: 'border-red-500/30 bg-red-500/10 text-red-300',
};
const TABS = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'];

const fmtDate  = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtMoney = (a, c) => `${c || 'PKR'} ${Number(a).toLocaleString()}`;

export default function ManualPaymentsQueue() {
  const [tab, setTab]           = useState('PENDING');
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [busyId, setBusyId]     = useState(null);
  const [error, setError]       = useState('');
  const [proof, setProof]       = useState(null); // { url, filename }

  const load = async (status) => {
    setLoading(true);
    setError('');
    try {
      const res = await adminAPI.listManualPayments(status === 'ALL' ? {} : { status });
      setRows((res?.data ?? res)?.payments ?? []);
    } catch (err) {
      setError(err?.message || 'Could not load payments.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(tab); }, [tab]);

  // An <img> cannot send the Authorization header, and the proof route is
  // superadmin-only, so fetch it through the authorised axios instance and
  // hand the <img> an object URL instead.
  const viewProof = async (row) => {
    try {
      const res = await api.get(adminAPI.manualPaymentProofPath(row.id), { responseType: 'blob' });
      const blob = res instanceof Blob ? res : res?.data;
      setProof({ url: URL.createObjectURL(blob), filename: row.proofFilename || 'proof', mime: blob?.type });
    } catch {
      setError('Could not load the proof image.');
    }
  };

  const closeProof = () => {
    if (proof?.url) URL.revokeObjectURL(proof.url);
    setProof(null);
  };

  const approve = async (row) => {
    if (!window.confirm(
      `Approve ${fmtMoney(row.amount, row.currency)} from ${row.tenant?.name || 'this tenant'}?\n\n` +
      `This activates ${row.plan} for ${row.periodMonths} month(s) immediately. ` +
      `Confirm it appears on the bank statement first.`
    )) return;

    setBusyId(row.id);
    try {
      await adminAPI.approveManualPayment(row.id);
      await load(tab);
    } catch (err) {
      setError(err?.message || 'Approval failed.');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (row) => {
    const reason = window.prompt('Reason for rejection (shown to the client):', '');
    if (reason === null) return;
    setBusyId(row.id);
    try {
      await adminAPI.rejectManualPayment(row.id, reason);
      await load(tab);
    } catch (err) {
      setError(err?.message || 'Rejection failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="glass-card rounded-2xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-100">Bank transfer payments</h2>
          <p className="mt-1 text-xs text-slate-500">
            Approving activates the client&rsquo;s plan and sets its expiry. Verify against the bank statement first.
          </p>
        </div>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t ? 'bg-surface2/80 text-slate-100' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {t[0] + t.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      )}

      {loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          {tab === 'PENDING' ? 'Nothing awaiting review.' : 'No payments in this state.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 pr-4 font-medium">Client</th>
                <th className="pb-2 pr-4 font-medium">Amount</th>
                <th className="pb-2 pr-4 font-medium">Paid</th>
                <th className="pb-2 pr-4 font-medium">Buys</th>
                <th className="pb-2 pr-4 font-medium">Reference</th>
                <th className="pb-2 pr-4 font-medium">Proof</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-800/60 align-middle">
                  <td className="py-2.5 pr-4">
                    <span className="font-medium text-slate-200">{r.tenant?.name || '—'}</span>
                    <span className="ml-1.5 text-slate-600">{r.tenant?.slug}</span>
                  </td>
                  <td className="py-2.5 pr-4 font-medium text-slate-200">{fmtMoney(r.amount, r.currency)}</td>
                  <td className="py-2.5 pr-4">{fmtDate(r.paidAt)}</td>
                  <td className="py-2.5 pr-4">{r.plan} · {r.periodMonths}mo</td>
                  <td className="py-2.5 pr-4 font-mono text-slate-400">{r.reference || '—'}</td>
                  <td className="py-2.5 pr-4">
                    {r.hasProof ? (
                      <button onClick={() => viewProof(r)} className="text-accent hover:underline">View</button>
                    ) : <span className="text-slate-600">none</span>}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] || ''}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {r.status === 'PENDING' && (
                      <div className="flex gap-1.5">
                        <button onClick={() => approve(r)} disabled={busyId === r.id}
                          className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50">
                          {busyId === r.id ? '…' : 'Approve'}
                        </button>
                        <button onClick={() => reject(r)} disabled={busyId === r.id}
                          className="rounded-lg bg-red-500/15 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50">
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {proof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closeProof}>
          <div onClick={(e) => e.stopPropagation()} className="glass-card max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-200">{proof.filename}</h3>
              <button onClick={closeProof} className="text-xs text-slate-400 hover:text-slate-200">Close</button>
            </div>
            {proof.mime === 'application/pdf' ? (
              <iframe title="Payment proof" src={proof.url} className="h-[70vh] w-full rounded-lg border border-slate-800/60" />
            ) : (
              <img src={proof.url} alt="Payment proof" className="w-full rounded-lg border border-slate-800/60" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
