// src/pages/AdsPerformance.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@pages/Layout';
import { contentStudioAPI, campaignsAPI, resolveUploadUrl } from '@lib/api';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const CHANNEL_META = {
  meta_ad:           { label: 'Meta Ad',  cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  whatsapp_message:  { label: 'WhatsApp', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  instagram_caption: { label: 'Instagram',cls: 'bg-pink-500/15 text-pink-300 border-pink-500/30' },
  email:             { label: 'Email',    cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
};
const ANGLE_META = {
  fomo:       { label: 'FOMO',       cls: 'bg-red-500/10 text-red-300 border-red-500/20' },
  roi:        { label: 'ROI',        cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' },
  trust:      { label: 'Trust',      cls: 'bg-sky-500/10 text-sky-300 border-sky-500/20' },
  aspiration: { label: 'Aspiration', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20' },
  scarcity:   { label: 'Scarcity',   cls: 'bg-orange-500/10 text-orange-300 border-orange-500/20' },
  problem:    { label: 'Problem',    cls: 'bg-rose-500/10 text-rose-300 border-rose-500/20' },
  curiosity:  { label: 'Curiosity',  cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' },
};
const OBJECTIVES = [
  { value: 'OUTCOME_LEADS',     label: 'Lead Generation',   desc: 'Collect leads via forms' },
  { value: 'OUTCOME_TRAFFIC',   label: 'Website Traffic',   desc: 'Send people to your site' },
  { value: 'OUTCOME_AWARENESS', label: 'Brand Awareness',   desc: 'Reach a broad audience' },
  { value: 'OUTCOME_SALES',     label: 'Sales / Conversions', desc: 'Drive purchases or sign-ups' },
];
const CTA_TYPES = [
  'LEARN_MORE', 'SIGN_UP', 'GET_QUOTE', 'CONTACT_US', 'APPLY_NOW', 'DOWNLOAD', 'BOOK_TRAVEL',
];
const EMPTY_FORM = {
  name: '', objective: 'OUTCOME_LEADS',
  dailyBudget: 500, countries: ['PK'], ageMin: 25, ageMax: 65, startDate: '', endDate: '',
  pageId: '', headline: '', body: '', imageUrl: '', linkUrl: '', ctaType: 'LEARN_MORE',
};

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function AdsPerformance() {
  const [view, setView] = useState('studio'); // 'studio' | 'campaigns'

  // ── Content Studio state ───────────────────────────────────
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
  const [imageGeneratingId, setImageGeneratingId] = useState(null);
  const [blobPreviewUrl, setBlobPreviewUrl] = useState(null);
  const [blobPreviewLoading, setBlobPreviewLoading] = useState(false);
  const [loadingSaved,   setLoadingSaved]   = useState(false);
  const blobUrlRef = useRef(null);

  // ── Campaign Manager state ─────────────────────────────────
  const [campaigns,      setCampaigns]      = useState([]);
  const [campLoading,    setCampLoading]    = useState(false);
  const [campError,      setCampError]      = useState('');
  const [syncingId,      setSyncingId]      = useState(null);
  const [deletingId,     setDeletingId]     = useState(null);
  const [launchResult,   setLaunchResult]   = useState(null); // success payload

  // ── Wizard state ───────────────────────────────────────────
  const [wizardOpen,   setWizardOpen]   = useState(false);
  const [wizardStep,   setWizardStep]   = useState(1);
  const [wizardForm,   setWizardForm]   = useState(EMPTY_FORM);
  const [wizardError,  setWizardError]  = useState('');
  const [launching,    setLaunching]    = useState(false);

  // ─────────────────────────────────────────────────────────
  const activeDraft = drafts[activeIdx] || null;
  const imagePreviewSrc = useMemo(() => {
    if (!activeDraft?.imageUrl) return '';
    if (/^https?:\/\//i.test(activeDraft.imageUrl)) return activeDraft.imageUrl;
    return resolveUploadUrl(activeDraft.imageUrl);
  }, [activeDraft?.imageUrl]);
  const isHttpImage = !!(activeDraft?.imageUrl && /^https?:\/\//i.test(activeDraft.imageUrl));

  // Blob preview effect
  useEffect(() => {
    let cancelled = false;
    const id = activeDraft?.id;
    const imageUrl = activeDraft?.imageUrl;
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    if (!id || !imageUrl || isHttpImage) { setBlobPreviewUrl(null); setBlobPreviewLoading(false); return; }
    setBlobPreviewLoading(true); setBlobPreviewUrl(null);
    contentStudioAPI.getDraftImageFile(id)
      .then((blob) => { if (cancelled) return; const u = URL.createObjectURL(blob); blobUrlRef.current = u; setBlobPreviewUrl(u); })
      .catch(() => { if (cancelled) return; setError('Could not load image preview.'); })
      .finally(() => { if (!cancelled) setBlobPreviewLoading(false); });
    return () => { cancelled = true; if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; } setBlobPreviewUrl(null); setBlobPreviewLoading(false); };
  }, [activeDraft?.id, activeDraft?.imageUrl, isHttpImage]);

  const studioKpis = useMemo(() => ({
    total:    drafts.length,
    saved:    drafts.filter((d) => d.status === 'SAVED').length,
    published:drafts.filter((d) => d.status === 'PUBLISHED').length,
    approval: drafts.filter((d) => d.status === 'SENT_FOR_APPROVAL').length,
  }), [drafts]);

  const campKpis = useMemo(() => ({
    total:       campaigns.length,
    active:      campaigns.filter((c) => c.status === 'ACTIVE').length,
    totalSpend:  campaigns.reduce((s, c) => s + parseFloat(c.spend || 0), 0),
    totalLeads:  campaigns.reduce((s, c) => s + (c._count?.leads || 0), 0),
  }), [campaigns]);

  // ── Content Studio actions ─────────────────────────────────
  const loadSavedDrafts = async (silent = false) => {
    if (!silent) setError('');
    setLoadingSaved(true);
    try {
      const res   = await contentStudioAPI.listSavedDrafts(50);
      const saved = res?.data?.drafts ?? [];
      setDrafts(saved); setActiveIdx(0);
      if (saved.length > 0) {
        const first = saved[0];
        if (first?.brandProfile) {
          setBrandProfile(first.brandProfile);
          if (first?.session?.sourceUrl) setSourceUrl(first.session.sourceUrl);
          if (first?.session?.language)  setLanguage(first.session.language);
        }
        setStatus(`Loaded ${saved.length} saved drafts`);
      } else { setStatus('No saved drafts yet'); }
    } catch (e) { if (!silent) setError(e.message || 'Failed to load saved drafts'); }
    finally { setLoadingSaved(false); }
  };
  useEffect(() => { loadSavedDrafts(true); }, []);

  const dna = useMemo(() => {
    const raw = brandProfile?.rawExtraction || {};
    const toArr = (v) => Array.isArray(v) ? v.filter(Boolean).map(String) : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return {
      industry: raw.industry || null, tagline: raw.tagline || null,
      products: toArr(brandProfile?.products || raw.products), audience: toArr(brandProfile?.audience || raw.audience),
      painPoints: toArr(raw.pain_points), usps: toArr(raw.unique_selling_points), keyMessages: toArr(raw.key_messages),
      colors: toArr(brandProfile?.colors || raw.colors), logoUrl: brandProfile?.logoUrl || raw.logo_url || null,
      scraped: !!raw._sourceScraped,
    };
  }, [brandProfile]);

  const extract = async (forceRefresh = false) => {
    if (!sourceUrl.trim()) { setError('Please enter a URL first.'); return; }
    setError(''); setIsExtracting(true); setStatus('Fetching page and extracting brand DNA…');
    try {
      const res = await contentStudioAPI.extract({ sourceUrl: sourceUrl.trim(), language, forceRefresh });
      setBrandProfile(res.data ?? res); setStatus(forceRefresh ? 'Brand DNA re-extracted (fresh)' : 'Brand DNA extracted');
    } catch (e) { setError(e.message || 'Extraction failed.'); setStatus(''); }
    finally { setIsExtracting(false); }
  };

  const generate = async () => {
    if (!brandProfile?.id) { setError('Extract brand DNA first.'); return; }
    setError(''); setIsGenerating(true); setStatus('Generating 3 ad copy variants…');
    try {
      const res = await contentStudioAPI.generate({ brandProfileId: brandProfile.id, count: 3, language });
      const newDrafts = res?.data?.drafts ?? res?.drafts ?? [];
      setDrafts(newDrafts); setActiveIdx(0); setStatus(`Generated ${newDrafts.length} variants`);
    } catch (e) { setError(e.message || 'Generation failed.'); setStatus(''); }
    finally { setIsGenerating(false); }
  };

  const saveCurrent = async () => {
    if (!activeDraft) return;
    setError('');
    try {
      const res = await contentStudioAPI.updateDraft(activeDraft.id, { status: 'SAVED', body: activeDraft.body, subject: activeDraft.subject ?? null });
      const savedDraft = res?.data;
      if (savedDraft?.id && savedDraft?.status === 'SAVED') {
        setDrafts((p) => p.map((d) => (d.id === activeDraft.id ? { ...d, ...savedDraft } : d)));
        setStatus('Draft saved');
      }
    } catch (e) { setError(e.message || 'Save failed'); }
  };

  const publishCurrent = async () => {
    if (!activeDraft) return;
    try { await contentStudioAPI.publish(activeDraft.id); setDrafts((p) => p.map((d) => (d.id === activeDraft.id ? { ...d, status: 'PUBLISHED' } : d))); setStatus('Published to Meta'); }
    catch (e) { setError(e.message); }
  };

  const sendApproval = async () => {
    if (!activeDraft || !approvalPhone) { setError('Enter a WhatsApp number first.'); return; }
    try { await contentStudioAPI.sendApproval(activeDraft.id, approvalPhone); setDrafts((p) => p.map((d) => (d.id === activeDraft.id ? { ...d, status: 'SENT_FOR_APPROVAL' } : d))); setStatus('Sent for approval via WhatsApp'); }
    catch (e) { setError(e.message); }
  };

  const generateDraftImage = async (draftId) => {
    setImageGeneratingId(draftId); setError('');
    try {
      const res = await contentStudioAPI.draftImage(draftId);
      const payload = res?.data ?? res;
      const updatedDraft = payload?.draft;
      const rel = updatedDraft?.imageUrl ?? payload?.imageUrl;
      const abs = payload?.imageAbsoluteUrl;
      const displayUrl = abs || rel;
      if (updatedDraft || displayUrl) setDrafts((p) => p.map((d) => (d.id === draftId ? { ...d, ...updatedDraft, ...(displayUrl ? { imageUrl: displayUrl } : {}) } : d)));
      if (!displayUrl) setError('Server did not return an image URL.');
      else setStatus('Image generated');
    } catch (e) { setError(e.message || 'Image generation failed.'); }
    finally { setImageGeneratingId(null); }
  };

  const nextCard = () => setActiveIdx((i) => Math.min(i + 1, drafts.length - 1));
  const prevCard = () => setActiveIdx((i) => Math.max(i - 1, 0));

  // ── Campaign Manager actions ───────────────────────────────
  const loadCampaigns = async () => {
    setCampLoading(true); setCampError('');
    try {
      const res = await campaignsAPI.list();
      setCampaigns(res?.data ?? res ?? []);
    } catch (e) { setCampError(e.message || 'Failed to load campaigns'); }
    finally { setCampLoading(false); }
  };

  useEffect(() => { if (view === 'campaigns') loadCampaigns(); }, [view]);

  const handleSync = async (id) => {
    setSyncingId(id); setCampError('');
    try {
      const res = await campaignsAPI.sync(id);
      const updated = res?.data ?? res;
      setCampaigns((p) => p.map((c) => (c.id === id ? { ...c, ...updated } : c)));
    } catch (e) { setCampError(e.message); }
    finally { setSyncingId(null); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete campaign "${name}"? This only removes it from ASOS — the Meta campaign stays.`)) return;
    setDeletingId(id);
    try {
      await campaignsAPI.delete(id);
      setCampaigns((p) => p.filter((c) => c.id !== id));
    } catch (e) { setCampError(e.message); }
    finally { setDeletingId(null); }
  };

  // ── Wizard helpers ─────────────────────────────────────────
  const openWizard = () => { setWizardForm(EMPTY_FORM); setWizardStep(1); setWizardError(''); setLaunchResult(null); setWizardOpen(true); };
  const closeWizard = () => { setWizardOpen(false); setLaunchResult(null); };
  const wf = (field) => (e) => setWizardForm((p) => ({ ...p, [field]: e.target.value }));
  const wfNum = (field) => (e) => setWizardForm((p) => ({ ...p, [field]: Number(e.target.value) }));

  const validateStep = () => {
    if (wizardStep === 1) { if (!wizardForm.name.trim()) return 'Campaign name is required'; }
    if (wizardStep === 2) { if (!wizardForm.dailyBudget || wizardForm.dailyBudget < 100) return 'Minimum daily budget is 100 PKR'; }
    if (wizardStep === 3) {
      if (!wizardForm.pageId.trim())   return 'Facebook Page ID is required';
      if (!wizardForm.headline.trim()) return 'Headline is required';
      if (!wizardForm.body.trim())     return 'Ad copy body is required';
      if (!wizardForm.linkUrl.trim())  return 'Destination URL is required';
    }
    return null;
  };

  const nextStep = () => {
    const err = validateStep();
    if (err) { setWizardError(err); return; }
    setWizardError(''); setWizardStep((s) => s + 1);
  };
  const prevStep = () => { setWizardError(''); setWizardStep((s) => s - 1); };

  const handleLaunch = async () => {
    const err = validateStep();
    if (err) { setWizardError(err); return; }
    setWizardError(''); setLaunching(true);
    try {
      const res = await campaignsAPI.launch(wizardForm);
      const payload = res?.data ?? res;
      setLaunchResult(payload);
      await loadCampaigns();
    } catch (e) { setWizardError(e.message || 'Launch failed'); }
    finally { setLaunching(false); }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title="Ads"
        subtitle={view === 'studio' ? 'AI Content Studio — generate ad copy and visuals.' : 'Campaign Manager — launch and track Meta Ads campaigns.'}
        action={
          <div className="flex items-center gap-1 rounded-lg border border-slate-700/60 bg-surface/40 p-1">
            <TabBtn active={view === 'studio'}    onClick={() => setView('studio')}>Content Studio</TabBtn>
            <TabBtn active={view === 'campaigns'} onClick={() => setView('campaigns')}>Campaign Manager</TabBtn>
          </div>
        }
      />

      {/* ── Content Studio ─────────────────────────────────── */}
      {view === 'studio' && (
        <div className="space-y-6 p-6 lg:p-8">
          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <span>⚠</span><span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-200">×</button>
            </div>
          )}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile label="Generated"  value={String(studioKpis.total)}     tone="neutral" sub="total variants" />
            <KpiTile label="Saved"      value={String(studioKpis.saved)}     tone="up"      sub="kept for use" />
            <KpiTile label="Published"  value={String(studioKpis.published)} tone="up"      sub="sent to Meta" />
            <KpiTile label="Approvals"  value={String(studioKpis.approval)}  tone="neutral" sub="sent on WhatsApp" />
          </section>

          <section className="glass-card rounded-xl p-5">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && extract(false)} placeholder="Paste website URL (e.g. https://brand.com)" className="input-dark rounded-lg px-3 py-2 text-sm lg:col-span-2" />
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input-dark rounded-lg px-3 py-2 text-sm">
                <option value="en">English</option><option value="ur">Urdu</option>
              </select>
              <div className="flex gap-2">
                <button type="button" onClick={() => loadSavedDrafts(false)} disabled={loadingSaved} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-40">{loadingSaved ? <Spinner /> : null}{loadingSaved ? 'Loading…' : 'Load Saved'}</button>
                <button type="button" onClick={() => extract(false)} disabled={isExtracting || !sourceUrl.trim()} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs text-accent transition hover:bg-accent/30 disabled:opacity-40">{isExtracting ? <Spinner /> : null}{isExtracting ? 'Extracting…' : 'Extract DNA'}</button>
                <button type="button" onClick={generate} disabled={isGenerating || !brandProfile?.id} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent2 px-3 py-2 text-xs text-white transition disabled:opacity-40">{isGenerating ? <Spinner white /> : null}{isGenerating ? 'Generating…' : 'Generate'}</button>
              </div>
            </div>
          </section>

          {brandProfile && (
            <section className="glass-card rounded-xl p-5">
              <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  {dna.logoUrl && <img src={dna.logoUrl} alt="logo" className="h-8 w-auto rounded object-contain" onError={(e) => { e.target.style.display = 'none'; }} />}
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">{brandProfile.brandName}</h2>
                    {dna.tagline && <p className="text-xs text-slate-400 mt-0.5 italic">"{dna.tagline}"</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {dna.industry && <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300 capitalize">{dna.industry.replace(/_/g, ' ')}</span>}
                  <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${dna.scraped ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>{dna.scraped ? '✓ Live scraped' : '⚠ URL-only inference'}</span>
                  <button type="button" onClick={() => extract(true)} disabled={isExtracting} className="rounded-full border border-slate-700 bg-transparent px-2.5 py-0.5 text-[10px] text-slate-400 transition hover:border-indigo-500 hover:text-slate-200 disabled:opacity-40">↺ Re-extract</button>
                </div>
              </div>
              {brandProfile.tone && <div className="mb-3 rounded-lg border border-slate-800/60 bg-surface/30 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Brand Tone & Voice</div><p className="text-sm leading-relaxed text-slate-200">{brandProfile.tone}</p></div>}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <TagGroup label="Products / Services"   items={dna.products}    color="slate" />
                <TagGroup label="Target Audience"       items={dna.audience}    color="slate" />
                <TagGroup label="Pain Points Solved"    items={dna.painPoints}  color="rose" />
                <TagGroup label="Unique Selling Points" items={dna.usps}        color="indigo" />
                {dna.keyMessages.length > 0 && <div className="lg:col-span-2"><TagGroup label="Key Messages" items={dna.keyMessages} color="sky" /></div>}
              </div>
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

          <section className="glass-card overflow-hidden rounded-xl">
            <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
              <div><h2 className="text-sm font-semibold tracking-tight text-slate-100">Swipe Studio</h2><p className="mt-0.5 text-xs text-slate-500">Review each variant — save the best, skip the rest.</p></div>
              <div className="text-xs text-slate-500">{drafts.length ? `${activeIdx + 1} / ${drafts.length}` : 'No drafts yet'}</div>
            </div>
            <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
              <div className="flex flex-col gap-3">
                {activeDraft ? (
                  <>
                    <div className="flex items-center gap-2">
                      <ChannelBadge channel={activeDraft.channel} />
                      {activeDraft.metadata?.angle && <AngleBadge angle={activeDraft.metadata.angle} />}
                      {activeDraft.status && activeDraft.status !== 'GENERATED' && <span className="ml-auto rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase text-slate-400">{activeDraft.status.replace(/_/g, ' ')}</span>}
                    </div>
                    {activeDraft.subject && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Headline / Subject</div>
                        <input value={activeDraft.subject} onChange={(e) => setDrafts((p) => p.map((d, i) => i === activeIdx ? { ...d, subject: e.target.value } : d))} className="input-dark w-full rounded-lg px-3 py-2 text-sm font-medium" />
                      </div>
                    )}
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Copy</div>
                      <textarea value={activeDraft.body} onChange={(e) => setDrafts((p) => p.map((d, i) => i === activeIdx ? { ...d, body: e.target.value } : d))} className="input-dark h-44 w-full rounded-lg p-3 text-sm leading-relaxed" />
                      <div className="mt-1 text-right text-[10px] text-slate-600">{activeDraft.body?.length || 0} chars</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={prevCard} disabled={activeIdx === 0} className="rounded-md border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 disabled:opacity-30 hover:border-slate-500">← Prev</button>
                      <button type="button" onClick={nextCard} disabled={activeIdx === drafts.length - 1} className="rounded-md border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 disabled:opacity-30 hover:border-slate-500">Skip →</button>
                      <button type="button" onClick={saveCurrent} className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20">✓ Save</button>
                      <button type="button" onClick={() => generateDraftImage(activeDraft.id)} disabled={!!imageGeneratingId} className="ml-auto flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-40">
                        {imageGeneratingId === activeDraft.id ? <Spinner /> : '🎨'}
                        {imageGeneratingId === activeDraft.id ? 'Generating…' : 'Generate Image'}
                      </button>
                    </div>
                    {activeDraft.imageUrl && (
                      <div className="space-y-2">
                        <div className="overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/40 min-h-[120px] flex items-center justify-center">
                          {!isHttpImage && blobPreviewLoading && <div className="flex flex-col items-center gap-2 py-8 text-xs text-violet-400"><span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" />Loading preview…</div>}
                          {(isHttpImage ? imagePreviewSrc : blobPreviewUrl) && <img src={isHttpImage ? imagePreviewSrc : blobPreviewUrl} alt="AI-generated ad visual" className="w-full object-cover" onError={() => { if (isHttpImage) setError('Image could not be loaded.'); }} />}
                          {!isHttpImage && !blobPreviewLoading && !blobPreviewUrl && <p className="px-4 py-6 text-center text-xs text-slate-500">Preview could not be loaded.</p>}
                        </div>
                        {(blobPreviewUrl || (isHttpImage && imagePreviewSrc)) && <a href={blobPreviewUrl || imagePreviewSrc} target="_blank" rel="noreferrer" className="block text-xs text-violet-400 underline decoration-violet-500/40 hover:text-violet-300">Open image in new tab</a>}
                      </div>
                    )}
                    {imageGeneratingId === activeDraft.id && <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-violet-500/30 bg-violet-500/5"><div className="text-center"><div className="mx-auto mb-2 h-5 w-5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" /><p className="text-xs text-violet-400">Creating your ad visual…</p></div></div>}
                  </>
                ) : (
                  <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-500">
                    {brandProfile ? 'Click Generate to create ad variants' : 'Extract brand DNA first, then generate.'}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-4">
                {drafts.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">All Variants</div>
                    <div className="flex flex-wrap gap-1.5">
                      {drafts.map((d, i) => (
                        <button type="button" key={d.id} onClick={() => setActiveIdx(i)} className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors ${i === activeIdx ? 'border-accent/40 bg-accent/20 text-accent' : d.status === 'SAVED' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : d.status === 'PUBLISHED' ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-slate-700/60 text-slate-500 hover:text-slate-300'}`}>{i + 1}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Send for Client Approval</div>
                  <input value={approvalPhone} onChange={(e) => setApprovalPhone(e.target.value)} placeholder="Client WhatsApp (+92300…)" className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={publishCurrent} disabled={!activeDraft} className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent2 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">Publish to Meta</button>
                  <button type="button" onClick={sendApproval} disabled={!activeDraft || !approvalPhone} className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-300 disabled:opacity-40 hover:bg-emerald-500/20">Send Approval on WhatsApp</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── Campaign Manager ────────────────────────────────── */}
      {view === 'campaigns' && (
        <div className="space-y-6 p-6 lg:p-8">
          {campError && (
            <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <span>⚠</span><span className="flex-1">{campError}</span>
              <button type="button" onClick={() => setCampError('')} className="text-red-400 hover:text-red-200">×</button>
            </div>
          )}

          {/* KPIs */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile label="Campaigns"    value={String(campKpis.total)}                     tone="neutral" sub="total created" />
            <KpiTile label="Active"       value={String(campKpis.active)}                    tone="up"      sub="running now" />
            <KpiTile label="Total Spend"  value={`PKR ${campKpis.totalSpend.toLocaleString()}`} tone="neutral" sub="all-time synced" />
            <KpiTile label="Total Leads"  value={String(campKpis.totalLeads)}               tone="up"      sub="attributed" />
          </section>

          {/* Header + create button */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Your Campaigns</h2>
              <p className="mt-0.5 text-xs text-slate-500">Campaigns are created as PAUSED on Meta — activate them in Meta Ads Manager when ready.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={loadCampaigns} disabled={campLoading} className="rounded-lg border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 disabled:opacity-40">{campLoading ? 'Loading…' : '↺ Refresh'}</button>
              <button type="button" onClick={openWizard} className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-4 py-1.5 text-xs font-medium text-white transition hover:opacity-90">+ Create Campaign</button>
            </div>
          </div>

          {/* Campaign table */}
          {campLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-500"><Spinner /> <span className="ml-2 text-sm">Loading campaigns…</span></div>
          ) : campaigns.length === 0 ? (
            <div className="glass-card flex flex-col items-center justify-center rounded-xl py-16 text-center">
              <div className="mb-3 text-4xl">📊</div>
              <h3 className="text-sm font-semibold text-slate-200">No campaigns yet</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-xs">Click "Create Campaign" to launch your first Meta Ads campaign directly from ASOS.</p>
              <button type="button" onClick={openWizard} className="mt-4 rounded-lg bg-gradient-to-r from-accent to-accent2 px-5 py-2 text-sm font-medium text-white">Create Your First Campaign</button>
            </div>
          ) : (
            <div className="glass-card overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800/60">
                      {['Campaign', 'Status', 'Budget/Day', 'Spend', 'Impressions', 'Clicks', 'CTR', 'Conversions', 'Leads', 'Actions'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {campaigns.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-800/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-100 truncate max-w-[180px]">{c.name}</div>
                          {c.metaCampaignId && <div className="text-[10px] text-slate-500 font-mono">ID: {c.metaCampaignId.slice(0, 12)}…</div>}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-300">{c.budget ? `PKR ${Number(c.budget).toLocaleString()}` : '—'}</td>
                        <td className="px-4 py-3 text-slate-300">{Number(c.spend) > 0 ? `PKR ${Number(c.spend).toLocaleString()}` : '—'}</td>
                        <td className="px-4 py-3 text-slate-300">{c.impressions > 0 ? Number(c.impressions).toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 text-slate-300">{c.clicks > 0 ? Number(c.clicks).toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 text-slate-300">{c.ctr > 0 ? `${Number(c.ctr).toFixed(2)}%` : '—'}</td>
                        <td className="px-4 py-3 text-slate-300">{c.conversions > 0 ? c.conversions : '—'}</td>
                        <td className="px-4 py-3 text-slate-300">{c._count?.leads ?? 0}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => handleSync(c.id)} disabled={!c.metaCampaignId || syncingId === c.id} title="Sync metrics from Meta" className="rounded border border-slate-700/60 px-2 py-1 text-[10px] text-slate-400 transition hover:border-sky-500/50 hover:text-sky-300 disabled:opacity-30">
                              {syncingId === c.id ? <Spinner /> : '⟳ Sync'}
                            </button>
                            {c.metaCampaignId && (
                              <a href={`https://www.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${c.metaCampaignId}`} target="_blank" rel="noreferrer" className="rounded border border-slate-700/60 px-2 py-1 text-[10px] text-slate-400 transition hover:border-blue-500/50 hover:text-blue-300">↗ Meta</a>
                            )}
                            <button type="button" onClick={() => handleDelete(c.id, c.name)} disabled={deletingId === c.id} title="Remove from ASOS" className="rounded border border-slate-700/60 px-2 py-1 text-[10px] text-slate-400 transition hover:border-red-500/50 hover:text-red-400 disabled:opacity-30">
                              {deletingId === c.id ? <Spinner /> : '🗑'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Create Campaign Wizard Modal ─────────────────────── */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700/60 bg-[#0f1117] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800/60 px-6 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Create Meta Campaign</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Step {launchResult ? '✓' : wizardStep} of 4 — {['', 'Campaign Setup', 'Budget & Audience', 'Ad Creative', 'Review & Launch'][launchResult ? 5 : wizardStep] || 'Done'}</p>
              </div>
              <button type="button" onClick={closeWizard} className="text-slate-500 hover:text-slate-200 text-xl leading-none">×</button>
            </div>

            {/* Step indicators */}
            {!launchResult && (
              <div className="flex items-center gap-1 px-6 pt-4">
                {[1,2,3,4].map((s) => (
                  <div key={s} className="flex items-center gap-1">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${s < wizardStep ? 'bg-accent text-white' : s === wizardStep ? 'bg-accent/30 text-accent border border-accent/50' : 'bg-slate-800 text-slate-500'}`}>{s < wizardStep ? '✓' : s}</div>
                    {s < 4 && <div className={`h-px w-8 transition-colors ${s < wizardStep ? 'bg-accent/50' : 'bg-slate-800'}`} />}
                  </div>
                ))}
              </div>
            )}

            <div className="px-6 pb-2 pt-4 min-h-[320px]">
              {wizardError && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">⚠ {wizardError}</div>}

              {/* ── Step 1: Campaign Setup ── */}
              {!launchResult && wizardStep === 1 && (
                <div className="space-y-4">
                  <Field label="Campaign Name *">
                    <input value={wizardForm.name} onChange={wf('name')} placeholder="e.g. Boulevard Tower — June Launch" className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                  </Field>
                  <Field label="Objective *">
                    <div className="grid grid-cols-2 gap-2">
                      {OBJECTIVES.map((o) => (
                        <button key={o.value} type="button" onClick={() => setWizardForm((p) => ({ ...p, objective: o.value }))} className={`rounded-lg border px-3 py-2.5 text-left transition ${wizardForm.objective === o.value ? 'border-accent/50 bg-accent/15 text-accent' : 'border-slate-700/60 text-slate-400 hover:border-slate-500'}`}>
                          <div className="text-xs font-medium">{o.label}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{o.desc}</div>
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
              )}

              {/* ── Step 2: Budget & Audience ── */}
              {!launchResult && wizardStep === 2 && (
                <div className="space-y-4">
                  <Field label="Daily Budget (PKR) *" hint="Minimum 100 PKR. This is in your ad account currency.">
                    <input type="number" min="100" value={wizardForm.dailyBudget} onChange={wfNum('dailyBudget')} className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Age Min">
                      <input type="number" min="18" max="64" value={wizardForm.ageMin} onChange={wfNum('ageMin')} className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                    </Field>
                    <Field label="Age Max">
                      <input type="number" min="19" max="65" value={wizardForm.ageMax} onChange={wfNum('ageMax')} className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Start Date" hint="Leave blank to start immediately">
                      <input type="date" value={wizardForm.startDate} onChange={wf('startDate')} className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                    </Field>
                    <Field label="End Date" hint="Leave blank for ongoing">
                      <input type="date" value={wizardForm.endDate} onChange={wf('endDate')} className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                    </Field>
                  </div>
                  <Field label="Countries" hint="Comma-separated ISO codes, e.g. PK,AE,SA">
                    <input value={wizardForm.countries.join(',')} onChange={(e) => setWizardForm((p) => ({ ...p, countries: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) }))} className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                  </Field>
                </div>
              )}

              {/* ── Step 3: Ad Creative ── */}
              {!launchResult && wizardStep === 3 && (
                <div className="space-y-3">
                  <Field label="Facebook Page ID *" hint="Found in your Facebook Page → About → Page ID">
                    <input value={wizardForm.pageId} onChange={wf('pageId')} placeholder="e.g. 123456789012345" className="input-dark w-full rounded-lg px-3 py-2 text-sm font-mono" />
                  </Field>
                  <Field label="Headline *" hint="Max ~40 chars recommended">
                    <input value={wizardForm.headline} onChange={wf('headline')} placeholder="Invest in Boulevard Tower REIT — 31% IRR" className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                  </Field>
                  <Field label="Ad Copy *">
                    <textarea value={wizardForm.body} onChange={wf('body')} rows={3} placeholder="Sardar Group ka premium project, Arif Habib managed. I-14 Islamabad. 20% down, 42 months…" className="input-dark w-full rounded-lg px-3 py-2 text-sm leading-relaxed" />
                  </Field>
                  <Field label="Destination URL *" hint="Where people land after clicking the ad">
                    <input value={wizardForm.linkUrl} onChange={wf('linkUrl')} placeholder="https://getaisales.com" className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Ad Image URL" hint="Optional — publicly accessible HTTPS URL">
                      <input value={wizardForm.imageUrl} onChange={wf('imageUrl')} placeholder="https://…/image.jpg" className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
                    </Field>
                    <Field label="CTA Button">
                      <select value={wizardForm.ctaType} onChange={wf('ctaType')} className="input-dark w-full rounded-lg px-3 py-2 text-sm">
                        {CTA_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>
              )}

              {/* ── Step 4: Review ── */}
              {!launchResult && wizardStep === 4 && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-4 space-y-2 text-sm">
                    <ReviewRow label="Campaign Name" value={wizardForm.name} />
                    <ReviewRow label="Objective"     value={OBJECTIVES.find((o) => o.value === wizardForm.objective)?.label} />
                    <ReviewRow label="Daily Budget"  value={`PKR ${Number(wizardForm.dailyBudget).toLocaleString()}`} />
                    <ReviewRow label="Target"        value={`Ages ${wizardForm.ageMin}–${wizardForm.ageMax} • ${wizardForm.countries.join(', ')}`} />
                    <ReviewRow label="Page ID"       value={wizardForm.pageId} mono />
                    <ReviewRow label="Headline"      value={wizardForm.headline} />
                    <ReviewRow label="Destination"   value={wizardForm.linkUrl} mono />
                    <ReviewRow label="CTA"           value={wizardForm.ctaType.replace(/_/g, ' ')} />
                    {wizardForm.imageUrl && <ReviewRow label="Image URL" value={wizardForm.imageUrl} mono />}
                  </div>
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
                    ⚠ Campaign and ads will be created as <strong>PAUSED</strong> on Meta. Go to Meta Ads Manager to review and activate them.
                  </div>
                </div>
              )}

              {/* ── Success ── */}
              {launchResult && (
                <div className="space-y-4 py-2">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-2xl">✓</div>
                    <h3 className="text-base font-semibold text-slate-100">Campaign Created on Meta!</h3>
                    <p className="text-xs text-slate-400 max-w-sm">{launchResult.message || 'Campaign created as PAUSED. Activate it in Meta Ads Manager when ready.'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-4 space-y-2 text-xs font-mono">
                    <div className="flex justify-between"><span className="text-slate-500">Campaign ID</span><span className="text-slate-200">{launchResult.meta?.campaignId}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Ad Set ID</span><span className="text-slate-200">{launchResult.meta?.adsetId}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Ad ID</span><span className="text-slate-200">{launchResult.meta?.adId}</span></div>
                  </div>
                  {launchResult.meta?.managerUrl && (
                    <a href={launchResult.meta.managerUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-lg bg-blue-600/20 border border-blue-500/30 px-4 py-2.5 text-sm text-blue-300 transition hover:bg-blue-600/30">
                      ↗ Open in Meta Ads Manager
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="flex items-center justify-between border-t border-slate-800/60 px-6 py-4">
              {launchResult ? (
                <button type="button" onClick={closeWizard} className="w-full rounded-lg bg-accent/20 border border-accent/30 px-4 py-2 text-sm text-accent hover:bg-accent/30">Done</button>
              ) : (
                <>
                  <button type="button" onClick={wizardStep === 1 ? closeWizard : prevStep} className="rounded-lg border border-slate-700/60 px-4 py-2 text-sm text-slate-400 transition hover:border-slate-500">{wizardStep === 1 ? 'Cancel' : '← Back'}</button>
                  {wizardStep < 4 ? (
                    <button type="button" onClick={nextStep} className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-5 py-2 text-sm font-medium text-white">Next →</button>
                  ) : (
                    <button type="button" onClick={handleLaunch} disabled={launching} className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent2 px-5 py-2 text-sm font-medium text-white disabled:opacity-60">
                      {launching ? <><Spinner white /> Launching…</> : '🚀 Launch on Meta'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'}`}>{children}</button>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-0.5 text-[10px] text-slate-600">{hint}</p>}
    </div>
  );
}

function ReviewRow({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`text-right text-slate-200 truncate max-w-[260px] ${mono ? 'font-mono text-[11px]' : ''}`}>{value || '—'}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    ACTIVE: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    PAUSED: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    ENDED:  'border-slate-700/60 bg-slate-800/40 text-slate-400',
  };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[status] || map.PAUSED}`}>{status}</span>;
}

function TagGroup({ label, items, color = 'slate' }) {
  const colorMap = { slate: 'border-slate-700/60 bg-bg/50 text-slate-300', rose: 'border-rose-500/20 bg-rose-500/10 text-rose-300', indigo: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300', sky: 'border-sky-500/20 bg-sky-500/10 text-sky-300' };
  return (
    <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.length ? items.map((item) => <span key={item} className={`rounded-full border px-2 py-0.5 text-[11px] ${colorMap[color] || colorMap.slate}`}>{item}</span>) : <span className="text-xs text-slate-600">Not detected</span>}
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
  const cls = tone === 'up' ? 'text-emerald-400' : 'text-slate-400';
  return (
    <div className="glass-card rounded-xl p-5">
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
      <div className={`mt-3 text-3xl font-semibold tracking-tight ${cls}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}
