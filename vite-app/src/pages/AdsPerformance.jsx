// src/pages/AdsPerformance.jsx — Ads page (route: /ads)
// Top performing WhatsApp ad copy variants for Boulevard Tower REIT.
import React from 'react';
import { PageHeader } from '@pages/Layout';

// ─────────────────────────────────────────────────────────────
// Mock data — top 3 ad copy variants by CTR
// ─────────────────────────────────────────────────────────────
const VARIANTS = [
  {
    id:        'v1',
    label:     'Logical',
    accent:    'border-cyan-500/30 bg-cyan-500/5',
    pill:      'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    angle:     'Facts-first — credentials, structure, returns',
    copy:      "Boulevard Tower REIT — Islamabad's premier I-14 development by Sardar Group (Centaurus). Managed by Arif Habib. Projected IRR 31%, capital appreciation 30-50%. Start from 100 sft (1 unit). 20% down, 42 months. RDA/CDC/SECP approved. Get details →",
    impressions: 84210,
    clicks:      4986,
    leads:        318,
    ctr:        '5.92%',
    cpl:        'PKR 412',
  },
  {
    id:        'v2',
    label:     'Emotional',
    accent:    'border-violet-500/30 bg-violet-500/5',
    pill:      'bg-violet-500/15 text-violet-300 border-violet-500/30',
    angle:     'Aspirational — generational security, beyond bank profit',
    copy:      "Bank profit 8% se aage sochna chahte hain? Boulevard Tower REIT — I-14 Islamabad. Sardar Group (Centaurus banaane wale) ka project, Arif Habib manage kar rahe hain. Projected IRR 31%. Apni next generation ka mustaqbil secure karein.",
    impressions: 71558,
    clicks:      4732,
    leads:        289,
    ctr:        '6.61%',
    cpl:        'PKR 388',
  },
  {
    id:        'v3',
    label:     'FOMO',
    accent:    'border-amber-500/30 bg-amber-500/5',
    pill:      'bg-amber-500/15 text-amber-300 border-amber-500/30',
    angle:     'Urgency — pre-PSX-listing window, limited units',
    copy:      "Pre-PSX-listing phase mein Boulevard Tower REIT mein invest karne ka mauqa. RDA/CDC/SECP approved. Sardar Group + Arif Habib. 31% projected IRR. 100 sft se start. PSX listing ke baad entry mehngi hogi. Limited units.",
    impressions: 92847,
    clicks:      6210,
    leads:        421,
    ctr:        '6.69%',
    cpl:        'PKR 351',
  },
];

const CHANNEL_BREAKDOWN = [
  { channel:'WhatsApp Click-to-Chat', spend:128400, leads: 612, cpl:'PKR 210', share:'58%' },
  { channel:'Facebook Lead Forms',    spend: 84200, leads: 284, cpl:'PKR 296', share:'27%' },
  { channel:'Instagram Reels',        spend: 41800, leads: 132, cpl:'PKR 317', share:'15%' },
];

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function AdsPerformance() {
  return (
    <>
      <PageHeader
        title="Ads"
        subtitle="Top-performing WhatsApp ad copy variants — last 30 days."
        action={
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 glow-green" />
            Synced from Meta · 2m ago
          </div>
        }
      />

      <div className="space-y-6 p-8">
        {/* Summary KPIs */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile label="Total Spend"   value="PKR 2.54L"  delta="-8%"   tone="up"      sub="vs last 30d (lower CPL)" />
          <KpiTile label="Total Leads"   value="1,028"      delta="+22%"  tone="up"      sub="WhatsApp + FB + IG"    />
          <KpiTile label="Avg CPL"       value="PKR 247"    delta="-18%"  tone="up"      sub="cost per qualified lead" />
          <KpiTile label="Best CTR"      value="6.69%"      delta="FOMO"  tone="neutral" sub="variant winning this week" />
        </section>

        {/* Variants */}
        <section className="glass-card overflow-hidden rounded-xl">
          <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">Top 3 Ad Copy Variants</h2>
              <p className="mt-0.5 text-xs text-slate-500">Sorted by leads in last 30 days. Edit copy or duplicate winners.</p>
            </div>
            <button
              onClick={() => alert('Demo: would open ad copy editor')}
              className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3 py-1.5 text-xs font-medium text-white shadow-md shadow-accent/20 transition-transform hover:scale-[1.02]"
            >
              + New Variant
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
            {VARIANTS.map((v) => <VariantCard key={v.id} v={v} />)}
          </div>
        </section>

        {/* Channel breakdown */}
        <section className="glass-card overflow-hidden rounded-xl">
          <div className="border-b border-slate-800/60 px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight text-slate-100">Channel Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-500">Spend and lead volume by channel.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface/40 text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5 font-semibold">Channel</th>
                  <th className="px-5 py-2.5 font-semibold">Spend</th>
                  <th className="px-5 py-2.5 font-semibold">Leads</th>
                  <th className="px-5 py-2.5 font-semibold">CPL</th>
                  <th className="px-5 py-2.5 font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {CHANNEL_BREAKDOWN.map((c) => (
                  <tr key={c.channel} className="border-t border-slate-800/40 hover:bg-surface2/30">
                    <td className="px-5 py-3 text-slate-100">{c.channel}</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-200">PKR {c.spend.toLocaleString()}</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-200">{c.leads}</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-400">{c.cpl}</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-400">{c.share}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Cards
// ─────────────────────────────────────────────────────────────
function VariantCard({ v }) {
  return (
    <div className={`flex flex-col rounded-xl border p-4 ${v.accent}`}>
      <div className="flex items-center justify-between">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${v.pill}`}>
          {v.label}
        </span>
        <span className="text-[10px] tabular-nums text-slate-500">CTR {v.ctr} · CPL {v.cpl}</span>
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{v.angle}</p>
      <p className="mt-3 whitespace-pre-line rounded-lg border border-slate-800/60 bg-surface/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-200">
        {v.copy}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Impr."   value={v.impressions.toLocaleString()} />
        <Stat label="Clicks"  value={v.clicks.toLocaleString()} />
        <Stat label="Leads"   value={v.leads.toLocaleString()} />
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={() => alert(`Demo: would duplicate ${v.label} variant`)}
          className="rounded-md border border-slate-700/60 bg-transparent px-2.5 py-1 text-[11px] text-slate-300 hover:bg-surface2/60"
        >
          Duplicate
        </button>
        <button
          onClick={() => alert(`Demo: would edit ${v.label} variant`)}
          className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md border border-slate-800/60 bg-surface/30 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-xs font-semibold tabular-nums text-slate-100">{value}</div>
    </div>
  );
}

function KpiTile({ label, value, delta, tone, sub }) {
  const cls =
    tone === 'up'   ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
    tone === 'down' ? 'text-red-400 bg-red-400/10 border-red-400/20'             :
                      'text-slate-400 bg-slate-400/10 border-slate-400/20';
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        {delta && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{delta}</span>}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}
