// src/pages/Billing.jsx — Billing & Plan (route: /billing).
// 4-tier global SaaS pricing (Starter / Growth / Pro / Agency) — mirrors getaisales-Landing.html.
import React, { useState, useCallback } from 'react';
import { PageHeader } from '@pages/Layout';

// ─────────────────────────────────────────────────────────────
// Plan + invoice mock data — single source of truth: landing page
// ─────────────────────────────────────────────────────────────
const PLANS = [
  {
    id:'starter',
    name:'Starter',
    monthly: 29,
    yearly:  276, // mirrors landing data-y=23/mo
    tagline:'For solo founders just starting with WhatsApp sales automation.',
    features:[
      '500 contacts',
      '2,000 AI messages / month',
      '1 WhatsApp number',
      '1 CRM pipeline',
      'Basic Meta Ads attribution',
      'Email support',
    ],
    cta:'Downgrade',
  },
  {
    id:'growth',
    name:'Growth',
    monthly: 79,
    yearly:  756, // landing data-y=63/mo
    tagline:'For small teams running active Meta Ad campaigns.',
    features:[
      '2,500 contacts',
      '10,000 AI messages / month',
      '2 WhatsApp numbers',
      '3 CRM pipelines',
      'Full Meta Ads + CAPI',
      'Chat support',
    ],
    cta:'Downgrade',
  },
  {
    id:'pro',
    name:'Pro',
    monthly: 149,
    yearly:  1428, // landing data-y=119/mo
    tagline:'For sales teams scaling WhatsApp + Meta into a real revenue engine.',
    highlight:true,
    badge:'Most Popular',
    features:[
      '10,000 contacts',
      '50,000 AI messages / month',
      '5 WhatsApp numbers',
      '10 CRM pipelines',
      'Custom AI persona',
      'Priority support',
    ],
    cta:'Current plan',
  },
  {
    id:'agency',
    name:'Agency',
    monthly: 349,
    yearly:  3348, // landing data-y=279/mo
    tagline:'For agencies reselling AI sales automation under their own brand.',
    features:[
      'Unlimited contacts',
      '250,000 AI messages / month',
      '25 sub-tenants',
      'White-label dashboard',
      'Custom integrations',
      'Dedicated support',
    ],
    cta:'Upgrade to Agency',
  },
];

const INVOICES = [
  { id:'inv-2026-04', date:'1 Apr 2026', plan:'Pro Monthly', amount:149.00, status:'Paid' },
  { id:'inv-2026-03', date:'1 Mar 2026', plan:'Pro Monthly', amount:149.00, status:'Paid' },
  { id:'inv-2026-02', date:'1 Feb 2026', plan:'Pro Monthly', amount:149.00, status:'Paid' },
  { id:'inv-2026-01', date:'1 Jan 2026', plan:'Pro Monthly', amount:149.00, status:'Paid' },
  { id:'inv-2025-12', date:'1 Dec 2025', plan:'Pro Monthly', amount:149.00, status:'Paid' },
  { id:'inv-2025-11', date:'1 Nov 2025', plan:'Pro Monthly', amount:149.00, status:'Paid' },
];

const USAGE = {
  aiCost:   { used: 218.42, limit: 1000,  unit: '$', label: 'AI cost (USD)' },
  messages: { used: 32400,  limit: 50000, unit: '',  label: 'AI messages' },
  numbers:  { used: 3,      limit: 5,     unit: '',  label: 'WhatsApp numbers' },
  seats:    { used: 4,      limit: 10,    unit: '',  label: 'Team seats' },
};

// Demo proration: Pro $149 → Agency $349, ~13 days left in month
const PRORATION_TODAY = 87;

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function Billing() {
  const [cycle, setCycle]               = useState('monthly'); // 'monthly' | 'yearly'
  const [toast, setToast]               = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [upgradeTarget, setUpgradeTarget] = useState(null); // plan object or null

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const onSubscribe = (plan) => {
    if (plan.id === 'pro') return; // current plan
    if (plan.id === 'agency') {
      // Sales-led upgrade — open the upgrade modal with proration
      setUpgradeTarget(plan);
      return;
    }
    // Starter / Growth = downgrade
    if (confirm(`Demo: downgrade to ${plan.name}? You'll lose access to Pro features at the end of this cycle.`)) {
      showToast(`Plan change to ${plan.name} queued (demo)`);
    }
  };

  const onConfirmUpgrade = () => {
    const name = upgradeTarget?.name ?? 'Agency';
    setUpgradeTarget(null);
    showToast(`Upgrade to ${name} confirmed (demo) · prorated $${PRORATION_TODAY} charged today`);
  };

  const onUpdateCard  = () => showToast('Stripe customer portal would open in production');
  const onDownloadInv = (inv) => showToast(`Demo: would download ${inv.id}.pdf`);
  const onCancel      = () => { setConfirmCancel(false); showToast('Cancellation scheduled for end of cycle (demo)'); };

  return (
    <>
      <PageHeader
        title="Billing & Plan"
        subtitle="Manage your subscription, payment method, and invoices."
        action={
          <a
            href="https://stripe.com"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-accent sm:inline-flex"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400" />
            Powered by Stripe
          </a>
        }
      />

      <div className="space-y-6 p-6">
        <CurrentPlanCard cycle={cycle} setCycle={setCycle} onUpdateCard={onUpdateCard} />
        <PlanComparison cycle={cycle} onSubscribe={onSubscribe} />
        <UsageGrid />
        <PaymentMethod onUpdateCard={onUpdateCard} />
        <InvoiceTable onDownload={onDownloadInv} />
        <DangerZone onCancel={() => setConfirmCancel(true)} />
      </div>

      {confirmCancel && (
        <ConfirmCancelModal
          onClose={() => setConfirmCancel(false)}
          onConfirm={onCancel}
        />
      )}
      {upgradeTarget && (
        <UpgradeModal
          plan={upgradeTarget}
          proration={PRORATION_TODAY}
          onClose={() => setUpgradeTarget(null)}
          onConfirm={onConfirmUpgrade}
        />
      )}
      <Toast text={toast} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Current plan
// ─────────────────────────────────────────────────────────────
function CurrentPlanCard({ cycle, setCycle, onUpdateCard }) {
  return (
    <section className="glass-card overflow-hidden rounded-xl">
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-3">
        {/* Plan badge */}
        <div className="border-b border-slate-800/60 p-6 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 text-base font-bold text-white glow-accent">
              P
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight text-slate-100">Pro Plan</div>
              <div className="text-[11px] uppercase tracking-wider text-emerald-400">● Active</div>
            </div>
          </div>
          <div className="text-sm text-slate-400">$149 / month · billed monthly</div>
          <div className="mt-1 text-xs text-slate-500">Renews 1 May 2026 · auto-renew</div>
        </div>

        {/* Billing cycle toggle */}
        <div className="border-b border-slate-800/60 p-6 lg:border-b-0 lg:border-r">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Billing cycle</div>
          <div className="mt-2 inline-flex items-center rounded-lg border border-slate-700/60 bg-surface/50 p-0.5">
            <button
              onClick={() => setCycle('monthly')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${cycle === 'monthly' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'}`}
            >Monthly</button>
            <button
              onClick={() => setCycle('yearly')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${cycle === 'yearly' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'}`}
            >Yearly <span className="ml-1 rounded bg-emerald-500/20 px-1 text-[9px] text-emerald-300">Save 17%</span></button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Switch to yearly and save $360 / year on the Pro plan.
          </p>
        </div>

        {/* Quick action */}
        <div className="flex flex-col justify-center gap-2 p-6">
          <button
            onClick={onUpdateCard}
            className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3.5 py-2 text-xs font-medium text-white shadow-md shadow-accent/20 transition-transform hover:scale-[1.02]"
          >
            Manage in Stripe →
          </button>
          <button
            onClick={onUpdateCard}
            className="rounded-lg border border-slate-700/60 bg-transparent px-3.5 py-2 text-xs text-slate-300 hover:bg-surface2/60"
          >
            Update payment method
          </button>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Plan comparison (4-up)
// ─────────────────────────────────────────────────────────────
function PlanComparison({ cycle, onSubscribe }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">Compare plans</h2>
        <span className="text-xs text-slate-500">Pro is your current plan</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => <PlanCard key={p.id} plan={p} cycle={cycle} onSubscribe={() => onSubscribe(p)} />)}
      </div>
    </section>
  );
}

function PlanCard({ plan, cycle, onSubscribe }) {
  const price = cycle === 'yearly' ? plan.yearly : plan.monthly;
  const isHighlight = plan.highlight;
  const priceLabel  = price === null ? 'Custom' : price === 0 ? 'Free' : `$${price}`;
  const cycleLabel  = price === null || price === 0 ? '' : cycle === 'yearly' ? '/ year' : '/ month';
  const isCurrent   = plan.id === 'pro';

  return (
    <div className={`relative flex flex-col rounded-xl border p-5 transition-all ${
      isHighlight
        ? 'border-violet-500/60 bg-gradient-to-b from-violet-500/10 to-transparent shadow-[0_0_30px_rgba(139,92,246,0.18)]'
        : 'border-slate-800/60 bg-surface/30 hover:border-slate-700'
    }`}>
      {plan.badge && (
        <span className="absolute -top-2.5 left-5 rounded-full bg-gradient-to-r from-accent to-accent2 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-md shadow-accent/30">
          {plan.badge}
        </span>
      )}
      <div className="text-sm font-semibold uppercase tracking-wider text-slate-200">{plan.name}</div>
      <p className="mt-1 text-xs text-slate-500 leading-relaxed">{plan.tagline}</p>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight text-slate-100">{priceLabel}</span>
        {cycleLabel && <span className="text-xs text-slate-500">{cycleLabel}</span>}
      </div>

      <ul className="mt-4 flex-1 space-y-2">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
            <svg viewBox="0 0 24 24" fill="none" stroke={isHighlight ? '#a78bfa' : '#64748b'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-3.5 w-3.5 shrink-0">
              <path d="M5 12l5 5L20 7" />
            </svg>
            {f}
          </li>
        ))}
      </ul>

      <button
        disabled={isCurrent}
        onClick={onSubscribe}
        className={`mt-5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
          isCurrent
            ? 'cursor-not-allowed border border-slate-700/60 bg-surface2/40 text-slate-500'
            : isHighlight
              ? 'bg-gradient-to-r from-accent to-accent2 text-white shadow-md shadow-accent/20 hover:scale-[1.01]'
              : plan.id === 'agency'
                ? 'bg-gradient-to-r from-accent to-accent2 text-white shadow-md shadow-accent/20 hover:scale-[1.01]'
                : 'border border-slate-700/60 bg-transparent text-slate-200 hover:bg-surface2/60'
        }`}
      >
        {plan.cta}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Usage grid
// ─────────────────────────────────────────────────────────────
function UsageGrid() {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">Usage this period</h2>
        <span className="text-xs text-slate-500">1 Apr — 30 Apr 2026</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(USAGE).map(([key, u]) => <UsageCard key={key} usage={u} />)}
      </div>
    </section>
  );
}

function UsageCard({ usage }) {
  const pct = usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : null;
  const tone = pct === null ? 'slate' : pct > 85 ? 'red' : pct > 60 ? 'amber' : 'emerald';
  const barCls = {
    emerald: 'bg-gradient-to-r from-emerald-500 to-emerald-400',
    amber:   'bg-gradient-to-r from-amber-500 to-amber-400',
    red:     'bg-gradient-to-r from-red-500 to-red-400',
    slate:   'bg-gradient-to-r from-accent to-accent2',
  }[tone];

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{usage.label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-slate-100">
          {usage.unit}{usage.used.toLocaleString()}
        </span>
        {usage.limit && (
          <span className="text-xs text-slate-500">/ {usage.unit}{usage.limit.toLocaleString()}</span>
        )}
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full transition-all ${barCls}`} style={{ width: pct === null ? '100%' : `${pct}%`, opacity: pct === null ? 0.25 : 1 }} />
      </div>
      <div className="mt-1 text-[10px] text-slate-500">
        {pct === null ? 'No limit on Pro' : `${pct}% used`}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Payment method
// ─────────────────────────────────────────────────────────────
function PaymentMethod({ onUpdateCard }) {
  return (
    <section className="glass-card rounded-xl">
      <header className="border-b border-slate-800/60 px-6 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">Payment method</h2>
      </header>
      <div className="flex items-center gap-4 p-6">
        <div className="flex h-10 w-14 items-center justify-center rounded-md border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 text-[10px] font-bold uppercase tracking-wider text-slate-300">
          Visa
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium tabular-nums text-slate-100">Visa •••• 4242</div>
          <div className="text-xs text-slate-500">Expires 12/27 · Default</div>
        </div>
        <button
          onClick={onUpdateCard}
          className="rounded-lg border border-slate-700/60 bg-transparent px-3 py-2 text-xs text-slate-300 hover:bg-surface2/60"
        >
          Update
        </button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Invoices
// ─────────────────────────────────────────────────────────────
function InvoiceTable({ onDownload }) {
  return (
    <section className="glass-card overflow-hidden rounded-xl">
      <header className="flex items-center justify-between border-b border-slate-800/60 px-6 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">Invoices</h2>
        <span className="text-xs text-slate-500">{INVOICES.length} on file</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface/40 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-6 py-2 font-semibold">Date</th>
              <th className="px-6 py-2 font-semibold">Plan</th>
              <th className="px-6 py-2 font-semibold">Amount</th>
              <th className="px-6 py-2 font-semibold">Status</th>
              <th className="px-6 py-2 text-right font-semibold">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {INVOICES.map((inv) => (
              <tr key={inv.id} className="border-t border-slate-800/40 hover:bg-surface2/40">
                <td className="px-6 py-3 text-xs tabular-nums text-slate-300">{inv.date}</td>
                <td className="px-6 py-3 text-xs text-slate-300">{inv.plan}</td>
                <td className="px-6 py-3 text-xs font-semibold tabular-nums text-slate-100">${inv.amount.toFixed(2)}</td>
                <td className="px-6 py-3">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                    inv.status === 'Paid'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700/60 bg-surface text-slate-500'
                  }`}>
                    {inv.status === 'Paid' && <span className="h-1 w-1 rounded-full bg-emerald-400" />}
                    {inv.status}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">
                  <button
                    onClick={() => onDownload(inv)}
                    className="text-[11px] text-accent transition-colors hover:underline"
                  >
                    Download PDF →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Danger zone (cancel subscription)
// ─────────────────────────────────────────────────────────────
function DangerZone({ onCancel }) {
  return (
    <section className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-red-300">Cancel subscription</h2>
          <p className="mt-1 text-xs leading-relaxed text-red-300/70">
            Your Pro plan will remain active until the end of your billing cycle (30 Apr 2026). After that, your workspace will revert to the Starter plan and Pro features will be paused.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="shrink-0 rounded-lg border border-red-500/30 bg-transparent px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
        >
          Cancel plan
        </button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Confirm cancel modal
// ─────────────────────────────────────────────────────────────
function ConfirmCancelModal({ onClose, onConfirm }) {
  const [text, setText] = useState('');
  const ok = text.trim().toUpperCase() === 'CANCEL';
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glass-card w-full max-w-md rounded-2xl p-6">
        <h2 className="text-base font-semibold tracking-tight text-slate-100">Cancel Pro subscription?</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          You'll keep Pro access until <span className="font-semibold text-slate-200">30 Apr 2026</span>. After that, your workspace falls back to the Starter plan: 500 contacts, 2,000 AI messages/month, 1 WhatsApp number.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Type <code className="rounded bg-surface2 px-1 py-0.5 font-mono text-red-300">CANCEL</code> below to confirm.
        </p>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="CANCEL"
          className="input-dark mt-2 w-full rounded-lg px-3 py-2 text-sm font-mono uppercase"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-700/60 bg-transparent px-3 py-2 text-xs text-slate-300 hover:bg-surface2/60">
            Keep Pro
          </button>
          <button
            disabled={!ok}
            onClick={onConfirm}
            className="rounded-lg border border-red-500/30 bg-red-500/15 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel my plan
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Confirm upgrade modal (Pro → Agency)
// ─────────────────────────────────────────────────────────────
function UpgradeModal({ plan, proration, onClose, onConfirm }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const upper = plan.name.toUpperCase();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glass-card w-full max-w-md rounded-2xl p-6">
        <h2 className="text-base font-semibold tracking-tight text-slate-100">
          Confirm upgrade to {upper} — ${plan.monthly}/month
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          You'll be charged a prorated <span className="font-semibold text-slate-200">${proration}</span> today for the rest of this billing cycle. Starting <span className="font-semibold text-slate-200">1 May 2026</span>, you'll be billed ${plan.monthly} / month on your default card.
        </p>
        <ul className="mt-3 space-y-1.5 rounded-lg border border-slate-800/60 bg-surface/30 p-3 text-xs text-slate-300">
          {plan.features.slice(0, 4).map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-3.5 w-3.5 shrink-0">
                <path d="M5 12l5 5L20 7" />
              </svg>
              {f}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-700/60 bg-transparent px-3 py-2 text-xs text-slate-300 hover:bg-surface2/60">
            Keep Pro
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3 py-2 text-xs font-medium text-white shadow-md shadow-accent/20 hover:scale-[1.01]"
          >
            Confirm upgrade · ${proration} today
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Toast (matches Settings)
// ─────────────────────────────────────────────────────────────
function Toast({ text }) {
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 animate-fade-in">
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300 shadow-2xl backdrop-blur-xl">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M5 12l5 5L20 7" />
        </svg>
        {text}
      </div>
    </div>
  );
}
