// src/components/billing/BankTransferPanel.jsx
//
// The real billing path. Stripe cannot receive payments for a Pakistani
// business, so clients transfer to the company bank account and upload the
// screenshot here; an admin verifies it against the statement and approves,
// which is what actually activates or extends the plan.
//
// The Stripe cards elsewhere on this page are left alone, but nothing in this
// flow touches them.
import React, { useEffect, useState } from 'react';
import { billingAPI } from '@lib/api';

const PLANS = ['PRO', 'ENTERPRISE'];

// Shown to the client so they know where to send money. Comes from build-time
// env so account numbers are not hard-coded in the repo.
const BANK = {
  bankName:      import.meta.env.VITE_BANK_NAME      || '',
  accountTitle:  import.meta.env.VITE_BANK_ACCOUNT_TITLE || '',
  accountNumber: import.meta.env.VITE_BANK_ACCOUNT_NUMBER || '',
  iban:          import.meta.env.VITE_BANK_IBAN      || '',
  // Optional: needed for an over-the-counter or interbank (IBFT) deposit,
  // where the IBAN alone isn't always what a teller or app asks for.
  branch:        import.meta.env.VITE_BANK_BRANCH      || '',
  branchCode:    import.meta.env.VITE_BANK_BRANCH_CODE  || '',
};
const hasBankDetails = Object.values(BANK).some(Boolean);

const STATUS_STYLES = {
  PENDING:  'border-amber-500/30 bg-amber-500/10 text-amber-300',
  APPROVED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  REJECTED: 'border-red-500/30 bg-red-500/10 text-red-300',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtMoney = (a, c) => `${c || 'PKR'} ${Number(a).toLocaleString()}`;

export default function BankTransferPanel({ onToast }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const [amount, setAmount]         = useState('');
  const [paidAt, setPaidAt]         = useState(() => new Date().toISOString().slice(0, 10));
  const [plan, setPlan]             = useState('PRO');
  const [periodMonths, setMonths]   = useState(1);
  const [reference, setReference]   = useState('');
  const [notes, setNotes]           = useState('');
  const [proof, setProof]           = useState(null);

  const load = async () => {
    try {
      const res = await billingAPI.listManualPayments();
      setPayments(res?.data ?? res ?? []);
    } catch {
      // A failed history load must not hide the submission form — the client
      // still needs to be able to tell us they paid.
      setPayments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!amount || Number(amount) <= 0) return setError('Enter the amount you transferred.');
    if (!proof) return setError('Attach the transfer screenshot or receipt.');

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('amount', String(amount));
      fd.append('currency', 'PKR');
      fd.append('paidAt', paidAt);
      fd.append('plan', plan);
      fd.append('periodMonths', String(periodMonths));
      if (reference) fd.append('reference', reference);
      if (notes) fd.append('notes', notes);
      fd.append('proof', proof);

      await billingAPI.submitManualPayment(fd);
      setAmount(''); setReference(''); setNotes(''); setProof(null);
      e.target.reset?.();
      onToast?.('Payment submitted — we will verify and activate your plan.');
      await load();
    } catch (err) {
      setError(err?.message || 'Could not submit the payment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass-card rounded-2xl p-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight text-slate-100">Pay by bank transfer</h2>
        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-300">
          Pakistan
        </span>
      </div>
      <p className="mb-5 text-xs leading-relaxed text-slate-400">
        Transfer to the account below, then upload the screenshot. Your plan activates
        once we have matched the payment against our bank statement — usually within one
        business day.
      </p>

      {hasBankDetails ? (
        <dl className="mb-6 grid gap-x-6 gap-y-2 rounded-xl border border-slate-800/60 bg-surface/30 p-4 text-xs sm:grid-cols-2">
          {BANK.bankName      && (<div><dt className="text-slate-500">Bank</dt><dd className="font-medium text-slate-200">{BANK.bankName}</dd></div>)}
          {BANK.accountTitle  && (<div><dt className="text-slate-500">Account title</dt><dd className="font-medium text-slate-200">{BANK.accountTitle}</dd></div>)}
          {BANK.accountNumber && (<div><dt className="text-slate-500">Account number</dt><dd className="font-mono font-medium text-slate-200">{BANK.accountNumber}</dd></div>)}
          {BANK.iban          && (<div><dt className="text-slate-500">IBAN</dt><dd className="font-mono font-medium text-slate-200">{BANK.iban}</dd></div>)}
          {BANK.branch        && (<div><dt className="text-slate-500">Branch</dt><dd className="font-medium text-slate-200">{BANK.branch}</dd></div>)}
          {BANK.branchCode    && (<div><dt className="text-slate-500">Branch code</dt><dd className="font-mono font-medium text-slate-200">{BANK.branchCode}</dd></div>)}
        </dl>
      ) : (
        // Better an honest prompt than a card with blank fields the client
        // cannot pay into.
        <p className="mb-6 rounded-xl border border-slate-800/60 bg-surface/30 p-4 text-xs text-slate-400">
          Bank details are not configured yet. Contact us for the account information,
          then record your transfer below.
        </p>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (PKR)">
            <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="25000" className={inputCls} required />
          </Field>
          <Field label="Date of transfer">
            <input type="date" value={paidAt} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setPaidAt(e.target.value)} className={inputCls} required />
          </Field>
          <Field label="Plan">
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className={inputCls}>
              {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Months paid for">
            <select value={periodMonths} onChange={(e) => setMonths(Number(e.target.value))} className={inputCls}>
              {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m} {m === 1 ? 'month' : 'months'}</option>)}
            </select>
          </Field>
          <Field label="Bank reference / transaction ID" hint="optional">
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. HBL-20260811-9931" className={inputCls} />
          </Field>
          <Field label="Screenshot or receipt">
            <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => setProof(e.target.files?.[0] || null)}
              className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-surface2/60 file:px-3 file:py-2 file:text-xs file:text-slate-200 hover:file:bg-surface2"
              required />
          </Field>
        </div>

        <Field label="Note" hint="optional">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Anything we should know about this payment" className={inputCls} />
        </Field>

        {error && (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}

        <button type="submit" disabled={saving}
          className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-4 py-2.5 text-xs font-medium text-white shadow-md shadow-accent/20 transition-transform hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100">
          {saving ? 'Submitting…' : 'Submit payment for verification'}
        </button>
      </form>

      <div className="mt-8">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Your payments</h3>
        {loading ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="text-xs text-slate-500">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Amount</th>
                  <th className="pb-2 pr-4 font-medium">Plan</th>
                  <th className="pb-2 pr-4 font-medium">Reference</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-slate-800/60">
                    <td className="py-2.5 pr-4">{fmtDate(p.paidAt)}</td>
                    <td className="py-2.5 pr-4 font-medium text-slate-200">{fmtMoney(p.amount, p.currency)}</td>
                    <td className="py-2.5 pr-4">{p.plan} · {p.periodMonths}mo</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-400">{p.reference || '—'}</td>
                    <td className="py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[p.status] || ''}`}>
                        {p.status}
                      </span>
                      {p.status === 'REJECTED' && p.reviewNote && (
                        <span className="ml-2 text-[11px] text-slate-500">{p.reviewNote}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-700/60 bg-surface/40 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-accent focus:outline-none';

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-slate-400">
        {label}{hint && <span className="ml-1 text-slate-600">({hint})</span>}
      </span>
      {children}
    </label>
  );
}
