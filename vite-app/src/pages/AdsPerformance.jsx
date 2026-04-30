// src/pages/AdsPerformance.jsx — Ads page (route: /ads)
// Top performing WhatsApp ad copy variants for Boulevard Tower REIT.
import React, { useMemo, useState } from 'react';
import { PageHeader } from '@pages/Layout';
import { contentStudioAPI } from '@lib/api';

// ─────────────────────────────────────────────────────────────
// Mock data — top 3 ad copy variants by CTR
// ─────────────────────────────────────────────────────────────
const CHANNEL_BREAKDOWN = [];

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function AdsPerformance() {
  const [sourceUrl, setSourceUrl] = useState('');
  const [language, setLanguage] = useState('en');
  const [brandProfile, setBrandProfile] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [approvalPhone, setApprovalPhone] = useState('');
  const [status, setStatus] = useState('');
  const activeDraft = drafts[activeIdx] || null;
  const kpis = useMemo(() => ({
    total: drafts.length,
    saved: drafts.filter((d) => d.status === 'SAVED').length,
    published: drafts.filter((d) => d.status === 'PUBLISHED').length,
    approval: drafts.filter((d) => d.status === 'SENT_FOR_APPROVAL').length,
  }), [drafts]);
  const dna = useMemo(() => {
    const raw = brandProfile?.rawExtraction || {};
    const toArray = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean).map(String);
      if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim()).filter(Boolean);
      return [];
    };
    return {
      products: toArray(brandProfile?.products || raw.products),
      audience: toArray(brandProfile?.audience || raw.audience),
      colors: toArray(brandProfile?.colors || raw.colors),
      logoUrl: brandProfile?.logoUrl || raw.logo_url || null,
    };
  }, [brandProfile]);

  const extract = async () => {
    const res = await contentStudioAPI.extract({ sourceUrl, language });
    setBrandProfile(res.data);
    setStatus('Brand DNA extracted');
  };
  const generate = async () => {
    if (!brandProfile?.id) return;
    const res = await contentStudioAPI.generate({ brandProfileId: brandProfile.id, count: 10, language });
    setDrafts(res.data.drafts || []);
    setActiveIdx(0);
    setStatus('Generated 10 variants');
  };
  const saveCurrent = async () => {
    if (!activeDraft) return;
    const res = await contentStudioAPI.updateDraft(activeDraft.id, { status: 'SAVED', body: activeDraft.body, imageUrl: activeDraft.imageUrl });
    setDrafts((p) => p.map((d) => (d.id === activeDraft.id ? res.data : d)));
  };
  const publishCurrent = async () => {
    if (!activeDraft) return;
    await contentStudioAPI.publish(activeDraft.id);
    setDrafts((p) => p.map((d) => (d.id === activeDraft.id ? { ...d, status: 'PUBLISHED' } : d)));
  };
  const sendApproval = async () => {
    if (!activeDraft || !approvalPhone) return;
    await contentStudioAPI.sendApproval(activeDraft.id, approvalPhone);
    setDrafts((p) => p.map((d) => (d.id === activeDraft.id ? { ...d, status: 'SENT_FOR_APPROVAL' } : d)));
  };
  const nextCard = () => setActiveIdx((i) => Math.min(i + 1, drafts.length - 1));
  const prevCard = () => setActiveIdx((i) => Math.max(i - 1, 0));

  return (
    <>
      <PageHeader
        title="Ads"
        subtitle="AI Content Studio: extract, generate, edit, publish, and client approval."
        action={
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 glow-green" />
            {status || 'Ready'}
          </div>
        }
      />

      <div className="space-y-6 p-8">
        {/* Summary KPIs */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile label="Generated"   value={String(kpis.total)} tone="neutral" sub="total variants" />
          <KpiTile label="Saved"       value={String(kpis.saved)} tone="up" sub="kept by swipe/editor" />
          <KpiTile label="Published"   value={String(kpis.published)} tone="up" sub="sent to Meta" />
          <KpiTile label="Approvals"   value={String(kpis.approval)} tone="neutral" sub="sent on WhatsApp" />
        </section>

        <section className="glass-card rounded-xl p-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Paste client URL" className="input-dark rounded-lg px-3 py-2 text-sm lg:col-span-2" />
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input-dark rounded-lg px-3 py-2 text-sm">
              <option value="en">English</option>
              <option value="ur">Urdu</option>
            </select>
            <div className="flex gap-2">
              <button onClick={extract} className="rounded-lg bg-accent/20 px-3 py-2 text-xs text-accent">Extract DNA</button>
              <button onClick={generate} className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3 py-2 text-xs text-white">Generate</button>
            </div>
          </div>
        </section>

        {brandProfile && (
          <section className="glass-card rounded-xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">Extracted Brand DNA</h2>
              <span className="rounded-full border border-slate-700/60 bg-surface/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                {language === 'ur' ? 'Urdu' : 'English'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Brand Name</div>
                <div className="mt-1 text-sm text-slate-200">{brandProfile.brandName || 'N/A'}</div>
              </div>
              <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Source URL</div>
                <div className="mt-1 truncate text-sm text-slate-300">{brandProfile.sourceUrl || 'N/A'}</div>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-slate-800/60 bg-surface/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Tone Summary</div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                {brandProfile.tone || 'No tone extracted yet.'}
              </p>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Products</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {dna.products.length
                    ? dna.products.map((item) => (
                      <span key={`prod-${item}`} className="rounded-full border border-slate-700/60 bg-bg/50 px-2 py-0.5 text-[11px] text-slate-300">
                        {item}
                      </span>
                    ))
                    : <span className="text-xs text-slate-500">No products extracted</span>}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Audience</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {dna.audience.length
                    ? dna.audience.map((item) => (
                      <span key={`aud-${item}`} className="rounded-full border border-slate-700/60 bg-bg/50 px-2 py-0.5 text-[11px] text-slate-300">
                        {item}
                      </span>
                    ))
                    : <span className="text-xs text-slate-500">No audience extracted</span>}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Brand Colors</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {dna.colors.length
                    ? dna.colors.map((color) => (
                      <div key={`color-${color}`} className="flex items-center gap-1.5 rounded border border-slate-700/60 bg-bg/50 px-2 py-1">
                        <span className="inline-block h-3 w-3 rounded-sm border border-slate-600/60" style={{ backgroundColor: color }} />
                        <span className="text-[11px] text-slate-300">{color}</span>
                      </div>
                    ))
                    : <span className="text-xs text-slate-500">No colors extracted</span>}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Logo URL</div>
                {dna.logoUrl ? (
                  <a href={dna.logoUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm text-slate-300 hover:text-slate-100">
                    {dna.logoUrl}
                  </a>
                ) : (
                  <div className="mt-1 text-xs text-slate-500">No logo URL extracted</div>
                )}
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-slate-800/60 bg-surface/30 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Raw Extraction</div>
              <pre className="max-h-52 overflow-auto rounded-md border border-slate-800/60 bg-bg/60 p-2 text-[11px] leading-relaxed text-slate-300">
                {JSON.stringify(brandProfile.rawExtraction || {}, null, 2)}
              </pre>
            </div>
          </section>
        )}

        <section className="glass-card overflow-hidden rounded-xl">
          <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">Swipe Studio</h2>
              <p className="mt-0.5 text-xs text-slate-500">Skip / Save / Regenerate with in-app edit controls.</p>
            </div>
            <div className="text-xs text-slate-500">{drafts.length ? `${activeIdx + 1}/${drafts.length}` : 'No drafts'}</div>
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
            <div>
              {activeDraft ? (
                <textarea value={activeDraft.body} onChange={(e) => setDrafts((p) => p.map((d, i) => (i === activeIdx ? { ...d, body: e.target.value } : d)))} className="input-dark h-56 w-full rounded-lg p-3 text-sm" />
              ) : <div className="text-sm text-slate-500">Generate variants to start.</div>}
              <div className="mt-3 flex gap-2">
                <button onClick={prevCard} className="rounded-md border border-slate-700/60 px-2 py-1 text-xs">Prev</button>
                <button onClick={nextCard} className="rounded-md border border-slate-700/60 px-2 py-1 text-xs">Skip</button>
                <button onClick={saveCurrent} className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-xs text-accent">Save</button>
              </div>
            </div>
            <div>
              <input value={approvalPhone} onChange={(e) => setApprovalPhone(e.target.value)} placeholder="Client WhatsApp (+92...)" className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
              <div className="mt-3 flex gap-2">
                <button onClick={publishCurrent} className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3 py-2 text-xs text-white">Publish Meta</button>
                <button onClick={sendApproval} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">Send Approval</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Cards
// ─────────────────────────────────────────────────────────────
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
