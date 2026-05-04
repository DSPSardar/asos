// src/pages/AdsPerformance.jsx — AI Content Studio (route: /ads)
import React, { useMemo, useState } from 'react';
import { PageHeader } from '@pages/Layout';
import { contentStudioAPI, resolveUploadUrl } from '@lib/api';

// ─────────────────────────────────────────────────────────────
// Channel + Angle display config
// ─────────────────────────────────────────────────────────────
const CHANNEL_META = {
  meta_ad:           { label: 'Meta Ad',       cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  whatsapp_message:  { label: 'WhatsApp',       cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  instagram_caption: { label: 'Instagram',      cls: 'bg-pink-500/15 text-pink-300 border-pink-500/30' },
  email:             { label: 'Email',          cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
};

const ANGLE_META = {
  fomo:        { label: 'FOMO',        cls: 'bg-red-500/10 text-red-300 border-red-500/20' },
  roi:         { label: 'ROI',         cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' },
  trust:       { label: 'Trust',       cls: 'bg-sky-500/10 text-sky-300 border-sky-500/20' },
  aspiration:  { label: 'Aspiration',  cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20' },
  scarcity:    { label: 'Scarcity',    cls: 'bg-orange-500/10 text-orange-300 border-orange-500/20' },
  problem:     { label: 'Problem',     cls: 'bg-rose-500/10 text-rose-300 border-rose-500/20' },
  curiosity:   { label: 'Curiosity',   cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' },
};

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function AdsPerformance() {
  const [sourceUrl,      setSourceUrl]      = useState('');
  const [language,       setLanguage]       = useState('en');
  const [brandProfile,   setBrandProfile]   = useState(null);
  const [drafts,         setDrafts]         = useState([]);
  const [activeIdx,      setActiveIdx]      = useState(0);
  const [approvalPhone,  setApprovalPhone]  = useState('');
  const [status,         setStatus]         = useState('');
  const [error,          setError]          = useState('');
  const [isExtracting,    setIsExtracting]    = useState(false);
  const [isGenerating,    setIsGenerating]    = useState(false);
  const [imageGeneratingId, setImageGeneratingId] = useState(null); // draftId currently generating image

  const activeDraft = drafts[activeIdx] || null;

  const imagePreviewSrc = useMemo(
    () => (activeDraft?.imageUrl ? resolveUploadUrl(activeDraft.imageUrl) : ''),
    [activeDraft?.imageUrl],
  );

  const kpis = useMemo(() => ({
    total:    drafts.length,
    saved:    drafts.filter((d) => d.status === 'SAVED').length,
    published:drafts.filter((d) => d.status === 'PUBLISHED').length,
    approval: drafts.filter((d) => d.status === 'SENT_FOR_APPROVAL').length,
  }), [drafts]);

  const dna = useMemo(() => {
    const raw = brandProfile?.rawExtraction || {};
    const toArr = (v) => Array.isArray(v) ? v.filter(Boolean).map(String)
      : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return {
      industry:   raw.industry || null,
      tagline:    raw.tagline || null,
      products:   toArr(brandProfile?.products  || raw.products),
      audience:   toArr(brandProfile?.audience  || raw.audience),
      painPoints: toArr(raw.pain_points),
      usps:       toArr(raw.unique_selling_points),
      keyMessages:toArr(raw.key_messages),
      colors:     toArr(brandProfile?.colors    || raw.colors),
      logoUrl:    brandProfile?.logoUrl || raw.logo_url || null,
      scraped:    !!raw._sourceScraped,
    };
  }, [brandProfile]);

  // ── Actions ────────────────────────────────────────────────
  const extract = async (forceRefresh = false) => {
    if (!sourceUrl.trim()) { setError('Please enter a URL first.'); return; }
    setError('');
    setIsExtracting(true);
    setStatus('Fetching page and extracting brand DNA…');
    try {
      const res = await contentStudioAPI.extract({ sourceUrl: sourceUrl.trim(), language, forceRefresh });
      setBrandProfile(res.data ?? res);
      setStatus(forceRefresh ? 'Brand DNA re-extracted (fresh)' : 'Brand DNA extracted');
    } catch (e) {
      setError(e.message || 'Extraction failed — check the URL and try again.');
      setStatus('');
    } finally {
      setIsExtracting(false);
    }
  };

  const generate = async () => {
    if (!brandProfile?.id) { setError('Extract brand DNA first.'); return; }
    setError('');
    setIsGenerating(true);
    setStatus('Generating 3 ad copy variants…');
    try {
      const res = await contentStudioAPI.generate({ brandProfileId: brandProfile.id, count: 3, language });
      // res is already server JSON (interceptor does res => res.data)
      // server shape: { success, data: { session, drafts: [...] }, message }
      const newDrafts = res?.data?.drafts ?? res?.drafts ?? [];
      setDrafts(newDrafts);
      setActiveIdx(0);
      setStatus(`Generated ${newDrafts.length} variants — swipe to review`);
    } catch (e) {
      setError(e.message || 'Generation failed — try again.');
      setStatus('');
    } finally {
      setIsGenerating(false);
    }
  };

  const saveCurrent = async () => {
    if (!activeDraft) return;
    try {
      const res = await contentStudioAPI.updateDraft(activeDraft.id, {
        status:  'SAVED',
        body:    activeDraft.body,
        subject: activeDraft.subject ?? null,
      });
      setDrafts((p) => p.map((d) => (d.id === activeDraft.id ? (res.data ?? res) : d)));
      setStatus('Draft saved');
    } catch (e) { setError(e.message); }
  };

  const publishCurrent = async () => {
    if (!activeDraft) return;
    try {
      await contentStudioAPI.publish(activeDraft.id);
      setDrafts((p) => p.map((d) => (d.id === activeDraft.id ? { ...d, status: 'PUBLISHED' } : d)));
      setStatus('Published to Meta');
    } catch (e) { setError(e.message); }
  };

  const sendApproval = async () => {
    if (!activeDraft || !approvalPhone) { setError('Enter a WhatsApp number first.'); return; }
    try {
      await contentStudioAPI.sendApproval(activeDraft.id, approvalPhone);
      setDrafts((p) => p.map((d) => (d.id === activeDraft.id ? { ...d, status: 'SENT_FOR_APPROVAL' } : d)));
      setStatus('Sent for approval via WhatsApp');
    } catch (e) { setError(e.message); }
  };

  const generateDraftImage = async (draftId) => {
    setImageGeneratingId(draftId);
    setError('');
    try {
      const res = await contentStudioAPI.draftImage(draftId);
      // Interceptor returns body: { success, data: { draft, imageUrl, prompt }, message }
      const payload = res?.data ?? res;
      const updatedDraft = payload?.draft;
      const rel = updatedDraft?.imageUrl ?? payload?.imageUrl;
      const abs = payload?.imageAbsoluteUrl;
      const displayUrl = abs || rel;
      if (updatedDraft || displayUrl) {
        setDrafts((p) => p.map((d) => (d.id === draftId
          ? { ...d, ...updatedDraft, ...(displayUrl ? { imageUrl: displayUrl } : {}) }
          : d)));
      }
      if (!displayUrl) {
        setError('Server did not return an image URL. Check API logs for ev=content-studio-image.');
      } else {
        setStatus('Image generated');
      }
    } catch (e) {
      setError(e.message || 'Image generation failed — try again.');
    } finally {
      setImageGeneratingId(null);
    }
  };

  const nextCard = () => setActiveIdx((i) => Math.min(i + 1, drafts.length - 1));
  const prevCard = () => setActiveIdx((i) => Math.max(i - 1, 0));

  // ── Render ─────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title="Ads"
        subtitle="AI Content Studio — extract brand DNA, generate ad copy, publish or send for approval."
        action={
          <div className="hidden items-center gap-2 text-xs sm:flex">
            {(isExtracting || isGenerating) ? (
              <span className="flex items-center gap-1.5 text-indigo-400">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-400/30 border-t-indigo-400" />
                {status}
              </span>
            ) : status ? (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {status}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-500">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Ready
              </span>
            )}
          </div>
        }
      />

      <div className="space-y-6 p-6 lg:p-8">

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span>⚠</span>
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-200">×</button>
          </div>
        )}

        {/* KPI row */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTile label="Generated"  value={String(kpis.total)}     tone="neutral" sub="total variants" />
          <KpiTile label="Saved"      value={String(kpis.saved)}     tone="up"      sub="kept for use" />
          <KpiTile label="Published"  value={String(kpis.published)} tone="up"      sub="sent to Meta" />
          <KpiTile label="Approvals"  value={String(kpis.approval)}  tone="neutral" sub="sent on WhatsApp" />
        </section>

        {/* Control bar */}
        <section className="glass-card rounded-xl p-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && extract(false)}
              placeholder="Paste website URL (e.g. https://brand.com)"
              className="input-dark rounded-lg px-3 py-2 text-sm lg:col-span-2"
            />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="input-dark rounded-lg px-3 py-2 text-sm"
            >
              <option value="en">English</option>
              <option value="ur">Urdu</option>
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => extract(false)}
                disabled={isExtracting || !sourceUrl.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs text-accent transition hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isExtracting ? <Spinner /> : null}
                {isExtracting ? 'Extracting…' : 'Extract DNA'}
              </button>
              <button
                type="button"
                onClick={generate}
                disabled={isGenerating || !brandProfile?.id}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent2 px-3 py-2 text-xs text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isGenerating ? <Spinner white /> : null}
                {isGenerating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </section>

        {/* Brand DNA panel */}
        {brandProfile && (
          <section className="glass-card rounded-xl p-5">
            <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                {dna.logoUrl && (
                  <img src={dna.logoUrl} alt="logo" className="h-8 w-auto rounded object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                )}
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">{brandProfile.brandName}</h2>
                  {dna.tagline && <p className="text-xs text-slate-400 mt-0.5 italic">"{dna.tagline}"</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Industry badge */}
                {dna.industry && (
                  <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300 capitalize">
                    {dna.industry.replace(/_/g, ' ')}
                  </span>
                )}
                {/* Scraped indicator */}
                <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${dna.scraped ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
                  {dna.scraped ? '✓ Live scraped' : '⚠ URL-only inference'}
                </span>
                <span className="rounded-full border border-slate-700/60 bg-surface/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                  {language === 'ur' ? 'Urdu' : 'English'}
                </span>
                {/* Re-extract forces a fresh scrape bypassing 24h cache */}
                <button
                  type="button"
                  onClick={() => extract(true)}
                  disabled={isExtracting}
                  className="rounded-full border border-slate-700 bg-transparent px-2.5 py-0.5 text-[10px] text-slate-400 transition hover:border-indigo-500 hover:text-slate-200 disabled:opacity-40"
                >
                  ↺ Re-extract
                </button>
              </div>
            </div>

            {/* Tone */}
            {brandProfile.tone && (
              <div className="mb-3 rounded-lg border border-slate-800/60 bg-surface/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Brand Tone & Voice</div>
                <p className="text-sm leading-relaxed text-slate-200">{brandProfile.tone}</p>
              </div>
            )}

            {/* Tag grids */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <TagGroup label="Products / Services" items={dna.products} color="slate" />
              <TagGroup label="Target Audience"     items={dna.audience}   color="slate" />
              <TagGroup label="Pain Points Solved"  items={dna.painPoints} color="rose" />
              <TagGroup label="Unique Selling Points" items={dna.usps}     color="indigo" />
              {dna.keyMessages.length > 0 && (
                <div className="lg:col-span-2">
                  <TagGroup label="Key Messages" items={dna.keyMessages} color="sky" />
                </div>
              )}
            </div>

            {/* Colors */}
            {dna.colors.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-800/60 bg-surface/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Brand Colors</div>
                <div className="flex flex-wrap gap-2">
                  {dna.colors.map((color) => (
                    <div key={color} className="flex items-center gap-1.5 rounded border border-slate-700/60 bg-bg/50 px-2 py-1">
                      <span className="inline-block h-3 w-3 rounded-sm border border-slate-600/60" style={{ backgroundColor: color }} />
                      <span className="text-[11px] text-slate-300">{color}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Swipe Studio */}
        <section className="glass-card overflow-hidden rounded-xl">
          <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">Swipe Studio</h2>
              <p className="mt-0.5 text-xs text-slate-500">Review each variant — save the best, skip the rest.</p>
            </div>
            <div className="text-xs text-slate-500">{drafts.length ? `${activeIdx + 1} / ${drafts.length}` : 'No drafts yet'}</div>
          </div>

          <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
            {/* Left — editor */}
            <div className="flex flex-col gap-3">
              {activeDraft ? (
                <>
                  {/* Channel + angle badges */}
                  <div className="flex items-center gap-2">
                    <ChannelBadge channel={activeDraft.channel} />
                    {activeDraft.metadata?.angle && <AngleBadge angle={activeDraft.metadata.angle} />}
                    {activeDraft.status && activeDraft.status !== 'GENERATED' && (
                      <span className="ml-auto rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase text-slate-400">
                        {activeDraft.status.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>

                  {/* Subject line (for meta_ad / email) */}
                  {activeDraft.subject && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Headline / Subject</div>
                      <input
                        value={activeDraft.subject}
                        onChange={(e) => setDrafts((p) => p.map((d, i) => i === activeIdx ? { ...d, subject: e.target.value } : d))}
                        className="input-dark w-full rounded-lg px-3 py-2 text-sm font-medium"
                      />
                    </div>
                  )}

                  {/* Body */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Copy</div>
                    <textarea
                      value={activeDraft.body}
                      onChange={(e) => setDrafts((p) => p.map((d, i) => i === activeIdx ? { ...d, body: e.target.value } : d))}
                      className="input-dark h-44 w-full rounded-lg p-3 text-sm leading-relaxed"
                    />
                    <div className="mt-1 text-right text-[10px] text-slate-600">{activeDraft.body?.length || 0} chars</div>
                  </div>

                  {/* Navigation */}
                  <div className="flex gap-2">
                    <button type="button" onClick={prevCard} disabled={activeIdx === 0} className="rounded-md border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 disabled:opacity-30 hover:border-slate-500">← Prev</button>
                    <button type="button" onClick={nextCard} disabled={activeIdx === drafts.length - 1} className="rounded-md border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 disabled:opacity-30 hover:border-slate-500">Skip →</button>
                    <button type="button" onClick={saveCurrent} className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20">✓ Save</button>
                    <button
                      type="button"
                      onClick={() => generateDraftImage(activeDraft.id)}
                      disabled={!!imageGeneratingId}
                      className="ml-auto flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-300 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {imageGeneratingId === activeDraft.id ? <Spinner /> : '🎨'}
                      {imageGeneratingId === activeDraft.id ? 'Generating…' : 'Generate Image'}
                    </button>
                  </div>

                  {/* Generated image — below Generate Image; src is API origin + /uploads/... */}
                  {activeDraft.imageUrl && (
                    <div className="space-y-2">
                      <div className="overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/40">
                        <img
                          src={imagePreviewSrc}
                          alt="AI-generated ad visual"
                          className="w-full object-cover"
                          onError={() => {
                            setError('Image could not be loaded. Rebuild SPA with VITE_UPLOADS_ORIGIN or proxy /uploads to the API.');
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                        <span className="uppercase tracking-wider text-slate-600">Preview</span>
                        <a
                          href={imagePreviewSrc}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-violet-400 underline decoration-violet-500/40 hover:text-violet-300"
                        >
                          Open image in new tab
                        </a>
                      </div>
                    </div>
                  )}
                  {/* Image loading placeholder (Pollinations can take a few seconds to render) */}
                  {imageGeneratingId === activeDraft.id && (
                    <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-violet-500/30 bg-violet-500/5">
                      <div className="text-center">
                        <div className="mx-auto mb-2 h-5 w-5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" />
                        <p className="text-xs text-violet-400">Creating your ad visual…</p>
                        <p className="mt-1 text-[10px] text-slate-500">Using AI image generation</p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-500">
                  {brandProfile ? 'Click Generate to create ad variants' : 'Extract brand DNA first, then generate.'}
                </div>
              )}
            </div>

            {/* Right — actions */}
            <div className="flex flex-col gap-4">
              {/* Draft list — mini pills */}
              {drafts.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">All Variants</div>
                  <div className="flex flex-wrap gap-1.5">
                    {drafts.map((d, i) => (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => setActiveIdx(i)}
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                          i === activeIdx
                            ? 'border-accent/40 bg-accent/20 text-accent'
                            : d.status === 'SAVED' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : d.status === 'PUBLISHED' ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                            : 'border-slate-700/60 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Approval */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Send for Client Approval</div>
                <input
                  value={approvalPhone}
                  onChange={(e) => setApprovalPhone(e.target.value)}
                  placeholder="Client WhatsApp (+92300...)"
                  className="input-dark w-full rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={publishCurrent}
                  disabled={!activeDraft}
                  className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent2 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Publish to Meta
                </button>
                <button
                  type="button"
                  onClick={sendApproval}
                  disabled={!activeDraft || !approvalPhone}
                  className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-300 disabled:opacity-40 hover:bg-emerald-500/20"
                >
                  Send Approval on WhatsApp
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function TagGroup({ label, items, color = 'slate' }) {
  const colorMap = {
    slate:  'border-slate-700/60 bg-bg/50 text-slate-300',
    rose:   'border-rose-500/20 bg-rose-500/10 text-rose-300',
    indigo: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300',
    sky:    'border-sky-500/20 bg-sky-500/10 text-sky-300',
  };
  return (
    <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.length
          ? items.map((item) => (
            <span key={item} className={`rounded-full border px-2 py-0.5 text-[11px] ${colorMap[color] || colorMap.slate}`}>{item}</span>
          ))
          : <span className="text-xs text-slate-600">Not detected</span>
        }
      </div>
    </div>
  );
}

function ChannelBadge({ channel }) {
  const m = CHANNEL_META[channel] || { label: channel, cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${m.cls}`}>{m.label}</span>;
}

function AngleBadge({ angle }) {
  const m = ANGLE_META[angle] || { label: angle, cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

function Spinner({ white = false }) {
  return <span className={`h-3 w-3 animate-spin rounded-full border-2 ${white ? 'border-white/30 border-t-white' : 'border-accent/30 border-t-accent'}`} />;
}

function KpiTile({ label, value, tone, sub }) {
  const cls =
    tone === 'up' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
                    'text-slate-400 bg-slate-400/10 border-slate-400/20';
  return (
    <div className="glass-card rounded-xl p-5">
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}
