// src/pages/Settings.jsx — Settings (route: /settings).
// Left tab nav + right content panel. 6 tabs.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@pages/Layout';
import { settingsAPI, aiConfigAPI, knowledgeGapsAPI, authAPI } from '@lib/api';
import { useAuthStore } from '@stores/auth.store';

const TABS = [
  { id:'whatsapp',      label:'WhatsApp',         icon:IconWhatsApp,    desc:'Connect your WhatsApp Business number and test the connection.' },
  { id:'ai',            label:'AI Configuration', icon:IconSparkles,    desc:'System prompt, model selection, and AI→human handoff rules.' },
  { id:'team',          label:'Team',             icon:IconTeam,        desc:'Invite teammates and manage roles.' },
  { id:'notifications', label:'Notifications',    icon:IconBell,        desc:'Email and WhatsApp alerts on lead activity.' },
  { id:'integrations',  label:'Integrations',     icon:IconPlug,        desc:'Connect external tools (CRM, Sheets, Slack).' },
  { id:'billing',       label:'Billing & Plan',   icon:IconCard,        desc:'Manage your subscription and view invoices.' },
  { id:'account',       label:'Account',          icon:IconUser,        desc:'Update your email address, password, and account security.' },
];

const DEFAULT_AI_PROMPT = `You are an AI sales assistant for Boulevard Tower REIT — a premium real estate investment opportunity in Islamabad, Pakistan.

PRODUCT FACTS (use ONLY these — do not invent others):

LOCATION
- Adjacent to I-14 Islamabad (prime location)

DEVELOPER
- Sardar Group — track record includes Centaurus Mall Islamabad (iconic project) plus many other delivered projects

REIT MANAGER
- Arif Habib Group — Pakistan's top REIT manager

REGULATORY APPROVALS
- RDA approved
- CDC approved
- SECP approved
- All NOCs in place — fully government-approved

INVESTMENT STRUCTURE
- Pre-listing phase: will register on Pakistan Stock Exchange (PSX) within 3 years
- Until PSX listing, share trading is not available — investors hold units directly
- Sold as fractional units: 1 unit = 100 sft
- Starting investment size: 18,000 sft
- Buyer options:
  1. Fractional units (100 sft each — smallest entry point)
  2. Entire studio apartment
  3. Entire 1-bedroom apartment
  4. Entire 2-bedroom apartment
  5. Entire shop unit
  6. Sharing basis (multiple buyers split a unit)

PAYMENT PLAN
- 20% downpayment
- 42 monthly installments

PROJECTED RETURNS
- IRR: 31% (projected)
- Capital appreciation: 30% to 50%

COMMUNICATION STYLE
- Mix Urdu and English naturally (Pakistani urban professional register)
- Greet "Walaikum assalam" if customer opens with salam
- Respectful tone — sir / madam / bhai
- Lead with credibility (Sardar Group + Arif Habib + RDA/CDC/SECP approved)
- Be transparent that PSX listing is 3 years away
- Do NOT invent numbers or features beyond the facts above

QUALIFY EVERY LEAD ON
1. Investment budget (lakhs / crores)
2. Preferred buying option (fractional / studio / 1-bed / 2-bed / shop / sharing)
3. Investor type (HNWI / overseas Pakistani / first-time / institutional)
4. Timeline / urgency

ALWAYS
- Explain 1 unit = 100 sft clearly
- Mention 18,000 sft starting size, 20% down + 42 months
- Highlight 31% projected IRR and 30-50% capital appreciation when relevant
- Reference Sardar Group's Centaurus Mall track record for credibility
- Mention Arif Habib Group as REIT manager when discussing trust/management
- Mention RDA/CDC/SECP approvals when discussing legitimacy
- Offer a consultation call for HOT/WARM leads

ESCALATE TO HUMAN AGENT IMMEDIATELY WHEN
- Customer mentions payment dispute or refund
- Legal or regulatory question
- Custom payment terms requested
- Investment ticket size > PKR 5 crore
- Overseas Pakistani asking about SBP / remittance procedures
- Lead reaches PROPOSAL stage and is HOT`;

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function Settings() {
  const [tab, setTab]     = useState('whatsapp');
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <PageHeader title="Settings" subtitle={TABS.find((t) => t.id === tab)?.desc} />

      <div className="flex flex-col gap-6 p-6 lg:flex-row">
        {/* Left tab nav */}
        <TabNav active={tab} onChange={setTab} />

        {/* Right content panel */}
        <div className="min-w-0 flex-1 space-y-6">
          {tab === 'whatsapp'      && <WhatsAppTab      showToast={showToast} />}
          {tab === 'ai'            && <AITab            showToast={showToast} />}
          {tab === 'team'          && <TeamTab          onSave={() => showToast('Team updated ✓')} />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'integrations'  && <IntegrationsTab  onSave={(name) => showToast(`${name} connection demo ✓`)} />}
          {tab === 'billing'       && <BillingTab />}
          {tab === 'account'       && <AccountTab showToast={showToast} />}
        </div>
      </div>

      <Toast text={toast} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab navigation
// ─────────────────────────────────────────────────────────────
function TabNav({ active, onChange }) {
  return (
    <nav className="lg:w-56 lg:shrink-0">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <li key={t.id}>
              <button
                onClick={() => onChange(t.id)}
                className={`flex w-full shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all ${
                  isActive
                    ? 'bg-accent/15 text-white shadow-[inset_0_0_0_1px_rgba(99,102,241,0.25)]'
                    : 'text-slate-400 hover:bg-surface2/60 hover:text-slate-100'
                }`}
              >
                <t.icon className={`h-4 w-4 ${isActive ? 'text-accent' : 'text-slate-500'}`} />
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────
// Section + Field helpers
// ─────────────────────────────────────────────────────────────
function Section({ title, description, children, footer }) {
  return (
    <section className="glass-card overflow-hidden rounded-xl">
      <header className="border-b border-slate-800/60 px-6 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </header>
      <div className="space-y-5 p-6">{children}</div>
      {footer && <footer className="flex items-center justify-end gap-2 border-t border-slate-800/60 bg-surface/40 px-6 py-3">{footer}</footer>}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">{label}</span>
        {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function Toggle({ on, onChange, label, description }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-100">{label}</div>
        {description && <div className="mt-0.5 text-xs text-slate-500">{description}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        className={`relative mt-0.5 inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-0.5 inline-block h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function PrimaryButton({ children, onClick, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3.5 py-2 text-xs font-medium text-white shadow-md shadow-accent/20 transition-transform hover:scale-[1.02] active:scale-[0.99]"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, type = 'button', tone = 'default' }) {
  const cls = tone === 'danger'
    ? 'border-red-500/30 text-red-300 hover:bg-red-500/10'
    : 'border-slate-700/60 text-slate-300 hover:bg-surface2/60';
  return (
    <button type={type} onClick={onClick} className={`rounded-lg border bg-transparent px-3 py-2 text-xs ${cls}`}>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 1 — WhatsApp  (live DB-backed, production-ready)
// ─────────────────────────────────────────────────────────────
function WhatsAppTab({ showToast }) {
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [verifying,    setVerifying]    = useState(false);
  const [revealToken,  setRevealToken]  = useState(false);
  const [testPhone,    setTestPhone]    = useState('+92 ');
  const [testResult,   setTestResult]   = useState(null);
  const [sending,      setSending]      = useState(false);
  const [tenantName,   setTenantName]   = useState('');
  const [mockMode,     setMockMode]     = useState(true);
  const [tokenSaved,   setTokenSaved]   = useState(false);
  const [verifyResult, setVerifyResult] = useState(null); // { ok, phoneNumber, verifiedName, error, ... }

  // Editable fields
  const [waPhoneId,     setWaPhoneId]     = useState('');
  const [waAccessToken, setWaAccessToken] = useState('');
  const [waAppSecret,   setWaAppSecret]   = useState('');
  const [waVerifyToken, setWaVerifyToken] = useState('');

  // Fixed webhook URL — no tenant ID suffix
  const webhookUrl = 'https://api.getaisales.com/webhooks/whatsapp';

  useEffect(() => {
    settingsAPI.get()
      .then((data) => {
        const d = data?.data ?? data;
        setTenantName(d?.name || '');
        setWaPhoneId(d?.waPhoneId || '');
        setMockMode(d?.mockMode ?? true);
        setTokenSaved(d?.waTokenSaved ?? false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setVerifyResult(null);
    try {
      const payload = {};
      if (waPhoneId.trim())     payload.waPhoneId     = waPhoneId.trim();
      if (waAccessToken.trim()) payload.waAccessToken = waAccessToken.trim();
      if (waAppSecret.trim())   payload.waAppSecret   = waAppSecret.trim();
      if (waVerifyToken.trim()) payload.waVerifyToken = waVerifyToken.trim();
      await settingsAPI.updateWA(payload);
      if (payload.waAccessToken) setTokenSaved(true);
      setWaAccessToken('');
      setWaAppSecret('');
      showToast('WhatsApp settings saved ✓');
    } catch (err) {
      showToast(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await settingsAPI.verifyWA();
      const d = res?.data ?? res;
      setVerifyResult(d);
      if (d?.ok) {
        setMockMode(false);
        showToast('Connection verified with Meta ✓');
      }
    } catch (err) {
      setVerifyResult({ ok: false, error: err.response?.data?.message || err.message });
    } finally {
      setVerifying(false);
    }
  };

  const sendTest = async (e) => {
    e.preventDefault();
    setSending(true);
    setTestResult(null);
    try {
      const phone = testPhone.trim().replace(/\s+/g, '');
      await settingsAPI.testWA(phone);
      setTestResult({ ok: true, msg: `Test message sent to ${phone} ✓` });
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      setTestResult({ ok: false, msg: detail });
    } finally {
      setSending(false);
    }
  };

  const copy = (text) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    showToast('Copied to clipboard ✓');
  };

  // Derived connection state
  const isLive  = !mockMode && tokenSaved && !!waPhoneId;
  const isMock  = mockMode || !tokenSaved;

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading settings…</div>;

  return (
    <>
      <Section
        title="WhatsApp Business Connection"
        description="Connected via Meta Cloud API. Inbound messages are routed to the AI worker."
        footer={
          <>
            <SecondaryButton
              tone="danger"
              onClick={() => { setWaPhoneId(''); setTokenSaved(false); setMockMode(true); setVerifyResult(null); handleSave(); }}
            >
              Disconnect
            </SecondaryButton>
            <SecondaryButton onClick={handleVerify} disabled={verifying || !waPhoneId}>
              {verifying ? 'Verifying…' : 'Verify Connection'}
            </SecondaryButton>
            <PrimaryButton onClick={handleSave}>{saving ? 'Saving…' : 'Save Changes'}</PrimaryButton>
          </>
        }
      >
        {/* ── Status banner ── */}
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
          isLive ? 'border-emerald-500/30 bg-emerald-500/10'
          : isMock ? 'border-amber-500/30 bg-amber-500/10'
          : 'border-slate-700/60 bg-slate-800/30'
        }`}>
          <span className="relative mt-0.5 flex h-2.5 w-2.5 shrink-0">
            {isLive && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
              isLive ? 'bg-emerald-400' : isMock ? 'bg-amber-400' : 'bg-slate-600'
            }`} />
          </span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold ${isLive ? 'text-emerald-300' : isMock ? 'text-amber-300' : 'text-slate-400'}`}>
              {isLive ? 'Live — connected to Meta' : isMock ? 'Mock mode — Claude runs, messages not sent to WhatsApp' : 'Not connected'}
            </div>
            {isLive && waPhoneId && (
              <div className="text-xs tabular-nums text-emerald-300/70 mt-0.5">Phone ID: {waPhoneId} · {tenantName}</div>
            )}
            {isMock && (
              <div className="text-xs text-amber-300/70 mt-0.5">
                {!tokenSaved ? 'No access token saved — paste one below and save to go live' : 'Mock env flag is active on the server'}
              </div>
            )}
          </div>
        </div>

        {/* ── Verify result panel ── */}
        {verifyResult && (
          <div className={`rounded-lg border px-4 py-3 text-xs space-y-1 ${
            verifyResult.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}>
            {verifyResult.ok ? (
              <>
                <div className="font-semibold">✅ Meta confirmed this number</div>
                <div>Number: <span className="tabular-nums font-medium">{verifyResult.phoneNumber}</span></div>
                <div>Name: {verifyResult.verifiedName}</div>
                <div>Status: {verifyResult.status} · Quality: {verifyResult.qualityRating} · Throughput: {verifyResult.throughput}</div>
              </>
            ) : (
              <>
                <div className="font-semibold">❌ Verification failed</div>
                <div>{verifyResult.error}</div>
                {verifyResult.code && <div className="text-red-400/70">Meta error code: {verifyResult.code}{verifyResult.subcode ? ` / ${verifyResult.subcode}` : ''}</div>}
                {verifyResult.mockMode && <div className="text-amber-300">No credentials saved — still running in mock mode</div>}
              </>
            )}
          </div>
        )}

        <Field label="Phone Number ID" hint="From Meta Business → WhatsApp → Phone Numbers">
          <input
            value={waPhoneId}
            onChange={(e) => setWaPhoneId(e.target.value)}
            placeholder="e.g. 1092237367309586"
            className="input-dark w-full rounded-lg px-3 py-2 text-sm tabular-nums"
          />
        </Field>

        <Field label="Access Token" hint={tokenSaved ? 'Token saved — paste to replace' : 'Paste to update — leave blank to keep existing'}>
          <div className="relative">
            <input
              type={revealToken ? 'text' : 'password'}
              value={waAccessToken}
              onChange={(e) => setWaAccessToken(e.target.value)}
              placeholder={tokenSaved ? '●●●●●●●● (saved — paste to replace)' : 'EAAGm0PX… (paste to update)'}
              className="input-dark w-full rounded-lg px-3 py-2 pr-20 text-sm tabular-nums"
            />
            <button
              type="button"
              onClick={() => setRevealToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/10"
            >
              {revealToken ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>

        <Field label="App Secret" hint="From Meta Developer Console → App Settings → Basic. Leave blank to keep existing.">
          <input
            type="password"
            value={waAppSecret}
            onChange={(e) => setWaAppSecret(e.target.value)}
            placeholder="Paste to update"
            className="input-dark w-full rounded-lg px-3 py-2 text-sm tabular-nums"
          />
        </Field>

        <Field label="Webhook Verify Token" hint="You create this — must match Meta Developer Console exactly">
          <input
            value={waVerifyToken}
            onChange={(e) => setWaVerifyToken(e.target.value)}
            placeholder="e.g. asos-verify-abc123"
            className="input-dark w-full rounded-lg px-3 py-2 text-sm tabular-nums"
          />
        </Field>

        <Field label="Webhook URL" hint="Paste this into Meta Developer Console → WhatsApp → Configuration">
          <div className="relative">
            <input readOnly value={webhookUrl} className="input-dark w-full rounded-lg px-3 py-2 pr-16 text-sm text-slate-300 tabular-nums" />
            <button
              type="button"
              onClick={() => copy(webhookUrl)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/10"
            >
              Copy
            </button>
          </div>
        </Field>
      </Section>

      <Section title="Send Test Message" description="Sends a real WhatsApp message to verify the end-to-end connection. Requires live credentials (not mock mode).">
        <form onSubmit={sendTest} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Recipient phone (international format, e.g. +923001234567)">
            <input
              required
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+923001234567"
              className="input-dark w-full rounded-lg px-3 py-2 text-sm tabular-nums"
            />
          </Field>
          <PrimaryButton type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send Test'}</PrimaryButton>
        </form>
        {testResult && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${testResult.ok
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
            {testResult.msg}
          </div>
        )}
        {isMock && !testResult && (
          <p className="text-[11px] text-amber-400/70">
            ⚠ Running in mock mode — test will log but won't send a real WhatsApp message. Save live credentials first.
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          Need help? <a href="mailto:support@getaisales.com" className="text-accent hover:underline">Contact support →</a>
        </p>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 2 — AI Configuration  (live DB-backed)
// ─────────────────────────────────────────────────────────────
const DEFAULT_RULES = { payment: true, unanswered: true, legal: true, hotProposal: false };

function AITab({ showToast }) {
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const [model,    setModel]    = useState('claude-sonnet-4-6');
  const [prompt,   setPrompt]   = useState(DEFAULT_AI_PROMPT);
  const [tone,     setTone]     = useState('Professional');
  const [language, setLanguage] = useState('Urdu+English');
  const [budget,   setBudget]   = useState(200);
  const [rules,    setRules]    = useState(DEFAULT_RULES);

  // Live usage from subscription
  const [usageUsd,  setUsageUsd]  = useState(null);   // computed from tokens
  const [usagePct,  setUsagePct]  = useState(0);

  useEffect(() => {
    Promise.all([
      aiConfigAPI.get().catch(() => null),
      aiConfigAPI.usage().catch(() => null),
    ]).then(([cfgRes, usageRes]) => {
      const cfg   = cfgRes?.data  ?? cfgRes;
      const usage = usageRes?.data ?? usageRes;

      if (cfg) {
        if (cfg.model)          setModel(cfg.model);
        if (cfg.systemPrompt)   setPrompt(cfg.systemPrompt);
        if (cfg.tone)           setTone(cfg.tone);
        if (cfg.language)       setLanguage(cfg.language);
        if (cfg.monthlyBudget != null) setBudget(Number(cfg.monthlyBudget));
        if (cfg.handoffRules && typeof cfg.handoffRules === 'object') {
          setRules({ ...DEFAULT_RULES, ...cfg.handoffRules });
        }
      }

      if (usage) {
        // Rough USD estimate: $0.000003 per token (haiku blended rate)
        const tokensUsed = usage.aiTokensUsed || 0;
        const est = (tokensUsed * 0.000003).toFixed(2);
        setUsageUsd(est);
        setUsagePct(Math.min(100, Math.round((parseFloat(est) / (budget || 200)) * 100)));
      }
    }).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await aiConfigAPI.update({
        model,
        systemPrompt:  prompt,
        tone,
        language,
        monthlyBudget: budget,
        handoffRules:  rules,
      });
      showToast('AI configuration saved ✓');
    } catch (err) {
      showToast(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const pct  = Math.min(100, Math.round((parseFloat(usageUsd || 0) / (budget || 200)) * 100));
  const used = usageUsd ?? '—';

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading AI configuration…</div>;

  return (
    <>
      <Section
        title="AI Configuration"
        description="Tune the dual-agent (Qualifier + Closer) behavior. Changes apply to all new conversations immediately."
        footer={<PrimaryButton onClick={handleSave}>{saving ? 'Saving…' : 'Save Changes'}</PrimaryButton>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Closer Model">
            <select value={model} onChange={(e) => setModel(e.target.value)} className="input-dark w-full cursor-pointer rounded-lg px-3 py-2 text-sm">
              <option value="claude-opus-4-6">Claude Opus 4.6 — most capable, slowest</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6 — balanced (default)</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 — fast, cheap</option>
            </select>
          </Field>
          <Field label="Tone">
            <select value={tone} onChange={(e) => setTone(e.target.value)} className="input-dark w-full cursor-pointer rounded-lg px-3 py-2 text-sm">
              <option>Professional</option>
              <option>Friendly</option>
              <option>Aggressive</option>
            </select>
          </Field>
          <Field label="Language">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input-dark w-full cursor-pointer rounded-lg px-3 py-2 text-sm">
              <option>Urdu+English</option>
              <option>English Only</option>
              <option>Urdu Only</option>
            </select>
          </Field>
          <Field label="Monthly AI Budget (USD)">
            <input type="number" min={1} value={budget} onChange={(e) => setBudget(Number(e.target.value))}
              className="input-dark w-full rounded-lg px-3 py-2 text-sm tabular-nums" />
          </Field>
        </div>

        <Field label="System Prompt" hint={`${prompt.length.toLocaleString()} chars`}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={14}
            className="input-dark w-full resize-y rounded-lg px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-200"
          />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-slate-300">Estimated AI spend this month</span>
            <span className="tabular-nums text-slate-400">${used} / ${budget} ({pct}%)</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-accent to-accent2 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-slate-600">Estimated at $0.000003/token blended rate</p>
        </div>
      </Section>

      <Section
        title="Handoff Rules"
        description="When any toggled rule fires, AI pauses and the conversation is flagged 'Needs human' in the inbox."
        footer={<PrimaryButton onClick={handleSave}>{saving ? 'Saving…' : 'Save Changes'}</PrimaryButton>}
      >
        <Toggle on={rules.payment} onChange={(v) => setRules({ ...rules, payment: v })}
          label="Escalate to human on payment / refund mentions"
          description="Triggers on keywords like refund, payment dispute, transaction, charge-back, bank statement." />
        <Toggle on={rules.unanswered} onChange={(v) => setRules({ ...rules, unanswered: v })}
          label="Escalate after 3 unanswered AI replies"
          description="If the customer doesn't reply for 3 AI messages in a row, flag for a human follow-up." />
        <Toggle on={rules.legal} onChange={(v) => setRules({ ...rules, legal: v })}
          label="Escalate on legal / complaint keywords"
          description="Keywords: legal, lawsuit, complaint, FBR, consumer court, defamation, fraud." />
        <Toggle on={rules.hotProposal} onChange={(v) => setRules({ ...rules, hotProposal: v })}
          label="Always handoff for HOT leads in PROPOSAL stage"
          description="Recommended OFF — AI typically closes well at PROPOSAL. Toggle ON for high-touch enterprise deals." />
      </Section>

      <KnowledgeGapsSection />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// KNOWLEDGE GAPS — self-improving AI knowledge base
// ─────────────────────────────────────────────────────────────
function KnowledgeGapsSection() {
  const [gaps,    setGaps]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState({});   // gapId → draft answer text
  const [saving,  setSaving]  = useState({});   // gapId → bool
  const [filter,  setFilter]  = useState('all'); // 'all' | 'unanswered' | 'resolved'

  const load = () => {
    setLoading(true);
    const params = filter === 'unanswered' ? { resolved: false }
                 : filter === 'resolved'   ? { resolved: true  }
                 : {};
    knowledgeGapsAPI.list(params)
      .then((res) => {
        const list = res?.data?.gaps ?? res?.gaps ?? [];
        setGaps(list);
        // Pre-fill answer fields with existing answers
        const pre = {};
        list.forEach((g) => { if (g.answer) pre[g.id] = g.answer; });
        setAnswers((prev) => ({ ...pre, ...prev }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]); // eslint-disable-line

  const handleSave = async (gapId) => {
    const ans = (answers[gapId] || '').trim();
    if (!ans) return;
    setSaving((s) => ({ ...s, [gapId]: true }));
    try {
      await knowledgeGapsAPI.answer(gapId, ans);
      setGaps((prev) => prev.map((g) => g.id === gapId ? { ...g, answer: ans, resolved: true } : g));
    } catch (_) {}
    setSaving((s) => ({ ...s, [gapId]: false }));
  };

  const handleDelete = async (gapId) => {
    if (!window.confirm('Delete this question?')) return;
    try {
      await knowledgeGapsAPI.delete(gapId);
      setGaps((prev) => prev.filter((g) => g.id !== gapId));
    } catch (_) {}
  };

  const unansweredCount = gaps.filter((g) => !g.resolved).length;

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          Knowledge Gaps
          {unansweredCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
              {unansweredCount} unanswered
            </span>
          )}
        </span>
      }
      description="When leads ask questions the AI can't answer from your system prompt, they appear here. Answer them — the AI will use your answers in all future conversations automatically."
    >
      {/* Filter bar */}
      <div className="flex gap-1.5">
        {[['all', 'All'], ['unanswered', 'Unanswered'], ['resolved', 'Answered']].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
              filter === v
                ? 'bg-accent/20 text-accent'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-slate-500">Loading…</div>
      ) : gaps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700/60 py-10 text-center">
          <div className="text-2xl">🎉</div>
          <div className="mt-2 text-xs text-slate-500">
            {filter === 'unanswered' ? 'No unanswered questions — great!' : 'No knowledge gaps yet.'}
          </div>
          <div className="mt-1 text-[11px] text-slate-600">
            When leads ask something the AI doesn't know, it will appear here.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {gaps.map((gap) => (
            <div
              key={gap.id}
              className={`rounded-lg border p-4 transition-colors ${
                gap.resolved
                  ? 'border-emerald-800/30 bg-emerald-950/10'
                  : 'border-amber-800/30 bg-amber-950/10'
              }`}
            >
              {/* Question header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      gap.resolved
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-amber-500/15 text-amber-400'
                    }`}>
                      {gap.resolved ? '✓ Answered' : '⚠ Unanswered'}
                    </span>
                    {gap.timesAsked > 1 && (
                      <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-[10px] text-slate-400">
                        Asked {gap.timesAsked}× by leads
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-100 leading-relaxed">
                    "{gap.question}"
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(gap.id)}
                  className="shrink-0 text-[11px] text-slate-600 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  ✕
                </button>
              </div>

              {/* Answer field */}
              <div className="mt-3">
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  Your Answer (AI will use this exactly)
                </label>
                <textarea
                  value={answers[gap.id] || ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [gap.id]: e.target.value }))}
                  placeholder="Type your answer here — be specific. The AI will quote this directly."
                  rows={3}
                  className="input-dark w-full resize-y rounded-lg px-3 py-2 text-xs leading-relaxed text-slate-200 placeholder:text-slate-600"
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-slate-600">
                    {gap.resolved ? `Last updated ${new Date(gap.updatedAt).toLocaleDateString()}` : 'Not yet answered'}
                  </span>
                  <button
                    onClick={() => handleSave(gap.id)}
                    disabled={saving[gap.id] || !(answers[gap.id] || '').trim()}
                    className="rounded-lg bg-accent/80 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-accent disabled:opacity-40 transition-colors"
                  >
                    {saving[gap.id] ? 'Saving…' : gap.resolved ? 'Update Answer' : 'Save & Activate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-600 leading-relaxed">
        ✨ Answered questions are injected into every conversation automatically — no need to edit the system prompt.
        The more you answer, the smarter the AI gets.
      </p>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 3 — Team
// ─────────────────────────────────────────────────────────────
const TEAM = [
  { id:'u1', name:'Saad Ali',     email:'saad@acme.com',    role:'Admin',   lastActive:'2m ago',   avatar:'SA' },
  { id:'u2', name:'Hira Ahmed',   email:'hira@acme.com',    role:'Manager', lastActive:'18m ago',  avatar:'HA' },
  { id:'u3', name:'Bilal Ahmed',  email:'bilal@acme.com',   role:'Agent',   lastActive:'1h ago',   avatar:'BA' },
];

function TeamTab({ onSave }) {
  const [inviting, setInviting] = useState(false);
  const [members, setMembers]   = useState(TEAM);
  return (
    <>
      <Section
        title="Team Members"
        description="Invite teammates to your workspace. Each member can be Admin, Manager, or Agent."
        footer={<PrimaryButton onClick={() => setInviting(true)}>+ Invite Member</PrimaryButton>}
      >
        {/* Mobile: card stack */}
        <ul className="space-y-2 md:hidden">
          {members.map((m) => (
            <li key={m.id} className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-xs font-semibold">{m.avatar}</div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-100">{m.name}</div>
                    <div className="truncate text-xs text-slate-500">{m.email}</div>
                  </div>
                </div>
                <button onClick={() => alert(`Demo: would remove ${m.name}`)} className="shrink-0 text-[11px] text-slate-500 transition-colors hover:text-red-400">
                  Remove
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <select
                  value={m.role}
                  onChange={(e) => setMembers(members.map((x) => x.id === m.id ? { ...x, role: e.target.value } : x))}
                  className="input-dark cursor-pointer rounded-md px-2 py-1 text-xs"
                >
                  <option>Admin</option><option>Manager</option><option>Agent</option>
                </select>
                <span className="text-xs tabular-nums text-slate-500">{m.lastActive}</span>
              </div>
            </li>
          ))}
        </ul>

        {/* Desktop: table */}
        <div className="hidden overflow-hidden rounded-lg border border-slate-800/60 md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface/40 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 font-semibold">Member</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Last active</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-slate-800/40 hover:bg-surface2/40">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-[10px] font-semibold">{m.avatar}</div>
                      <span className="text-slate-100">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">{m.email}</td>
                  <td className="px-3 py-2.5">
                    <select
                      value={m.role}
                      onChange={(e) => setMembers(members.map((x) => x.id === m.id ? { ...x, role: e.target.value } : x))}
                      className="input-dark cursor-pointer rounded-md px-2 py-1 text-xs"
                    >
                      <option>Admin</option><option>Manager</option><option>Agent</option>
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-500">{m.lastActive}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button onClick={() => alert(`Demo: would remove ${m.name}`)} className="text-[11px] text-slate-500 transition-colors hover:text-red-400">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Role Permissions">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <RoleCard role="Admin"   color="text-accent"     desc="Full access. Manage billing, integrations, team, and AI config." />
          <RoleCard role="Manager" color="text-cyan-300"   desc="Manage leads + conversations. Assign agents. Cannot change billing." />
          <RoleCard role="Agent"   color="text-amber-300"  desc="View assigned leads. Reply in conversations. Cannot invite or configure." />
        </div>
      </Section>

      {inviting && <InviteModal onClose={() => setInviting(false)} onInvite={(email, role) => { setInviting(false); onSave(); }} />}
    </>
  );
}

function RoleCard({ role, color, desc }) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
      <div className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{role}</div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{desc}</p>
    </div>
  );
}

function InviteModal({ onClose, onInvite }) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState('Agent');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onInvite(email, role); }}
        className="glass-card w-full max-w-md rounded-2xl p-6"
      >
        <h2 className="text-base font-semibold tracking-tight">Invite Team Member</h2>
        <p className="mt-1 text-xs text-slate-500">They'll receive an email to set their password and join the workspace.</p>
        <div className="mt-4 space-y-3">
          <Field label="Email">
            <input required type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@acme.com" className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value)} className="input-dark w-full cursor-pointer rounded-lg px-3 py-2 text-sm">
              <option>Admin</option><option>Manager</option><option>Agent</option>
            </select>
          </Field>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit">Send Invite</PrimaryButton>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 4 — Notifications
// ─────────────────────────────────────────────────────────────
function NotificationsTab() {
  const [adminPhone, setAdminPhone] = useState('');
  const [browserPerm, setBrowserPerm] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [prefs, setPrefs] = useState({
    newLead:    { whatsapp: false, browser: false },
    hotLead:    { whatsapp: true,  browser: true  },
    needsHuman: { whatsapp: true,  browser: true  },
    daily:      { whatsapp: false, browser: false },
    weekly:     { whatsapp: false, browser: false },
  });

  // Load saved prefs from backend on mount
  useEffect(() => {
    settingsAPI.get().then((res) => {
      const s = res.data?.data?.settings || res.data?.settings || {};
      if (s.adminPhone) setAdminPhone(s.adminPhone);
      if (s.notifPrefs) {
        setPrefs((prev) => {
          const merged = { ...prev };
          Object.keys(s.notifPrefs).forEach((k) => {
            if (merged[k]) merged[k] = { ...merged[k], ...s.notifPrefs[k] };
          });
          return merged;
        });
      }
    }).catch(() => {});
  }, []);

  const items = [
    { key:'newLead',    label:'New lead',      desc:'Fires when a new contact starts a conversation.' },
    { key:'hotLead',    label:'Hot lead',      desc:'Fires when AI scores a lead as HOT (score ≥ 8).' },
    { key:'needsHuman', label:'Needs human',   desc:'Fires when AI escalates to a human agent.' },
    { key:'daily',      label:'Daily digest',  desc:'9 AM PKT summary: new leads, conversion rate, AI cost.' },
    { key:'weekly',     label:'Weekly report', desc:'Monday 9 AM: pipeline change, won/lost, AI performance.' },
  ];

  const flip = (key, channel) =>
    setPrefs((p) => ({ ...p, [key]: { ...p[key], [channel]: !p[key][channel] } }));

  const requestBrowserPerm = async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setBrowserPerm(result);
    if (result === 'granted') {
      new Notification('ASOS Notifications enabled', {
        body: 'You will now receive browser alerts for hot leads and handoffs.',
        icon: '/favicon.ico',
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsAPI.update({ settings: { adminPhone, notifPrefs: prefs } });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save notification prefs', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Admin WhatsApp number */}
      <Section
        title="Admin WhatsApp Number"
        description="Receive live WhatsApp alerts on this number when key lead events fire."
      >
        <div className="flex max-w-sm flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-400">Phone number (with country code)</label>
          <input
            type="tel"
            value={adminPhone}
            onChange={(e) => setAdminPhone(e.target.value)}
            placeholder="e.g. 923001234567"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
          <p className="text-[11px] text-slate-600">No + or spaces — digits only. Must be on WhatsApp.</p>
        </div>
      </Section>

      {/* Browser notifications */}
      <Section
        title="Browser Notifications"
        description="Get desktop pop-ups for hot leads and handoffs, even when the tab is in the background."
      >
        <div className="flex items-center gap-4">
          {browserPerm === 'unsupported' && (
            <span className="text-sm text-slate-500">Browser notifications not supported in this environment.</span>
          )}
          {browserPerm === 'granted' && (
            <span className="flex items-center gap-2 rounded-full border border-emerald-700/40 bg-emerald-900/20 px-3 py-1 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Notifications enabled
            </span>
          )}
          {browserPerm === 'denied' && (
            <span className="text-xs text-rose-400">Notifications blocked. Allow them in your browser site settings, then reload.</span>
          )}
          {browserPerm === 'default' && (
            <button
              onClick={requestBrowserPerm}
              className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
            >
              Enable browser notifications
            </button>
          )}
        </div>
      </Section>

      {/* Alert preferences table */}
      <Section
        title="Alert Preferences"
        description="Choose which events notify you, and on which channel."
        footer={
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Preferences'}
          </button>
        }
      >
        {/* Mobile: card stack */}
        <ul className="space-y-2 md:hidden">
          {items.map((it) => (
            <li key={it.key} className="rounded-lg border border-slate-800/60 bg-surface/30 p-3">
              <div className="text-sm font-medium text-slate-100">{it.label}</div>
              <div className="mt-0.5 text-xs text-slate-500">{it.desc}</div>
              <div className="mt-3 flex items-center gap-5 border-t border-slate-800/40 pt-3">
                <div className="flex items-center gap-2">
                  <Checkbox on={prefs[it.key].whatsapp} onChange={() => flip(it.key, 'whatsapp')} />
                  <span className="text-xs text-slate-300">WhatsApp</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox on={prefs[it.key].browser} onChange={() => flip(it.key, 'browser')} />
                  <span className="text-xs text-slate-300">Browser</span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* Desktop: table */}
        <div className="hidden overflow-hidden rounded-lg border border-slate-800/60 md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface/40 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2 font-semibold">Event</th>
                <th className="w-28 px-4 py-2 text-center font-semibold">WhatsApp</th>
                <th className="w-28 px-4 py-2 text-center font-semibold">Browser</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} className="border-t border-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-100">{it.label}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{it.desc}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Checkbox on={prefs[it.key].whatsapp} onChange={() => flip(it.key, 'whatsapp')} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Checkbox on={prefs[it.key].browser} onChange={() => flip(it.key, 'browser')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Checkbox({ on, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`inline-flex h-5 w-5 items-center justify-center rounded border transition-colors ${
        on ? 'border-accent bg-accent text-white' : 'border-slate-700 bg-transparent text-transparent hover:border-slate-500'
      }`}
      aria-checked={on}
      role="checkbox"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
        <path d="M5 12l5 5L20 7" />
      </svg>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 5 — Integrations
// ─────────────────────────────────────────────────────────────
const INTEGRATIONS = [
  { name:'Google Sheets', desc:'Sync leads + conversations to a Google Sheet for reporting.', tag:'Productivity' },
  { name:'HubSpot',       desc:'Push qualified leads into HubSpot CRM with full conversation context.', tag:'CRM' },
  { name:'Salesforce',    desc:'Bidirectional sync with Salesforce Lead and Opportunity objects.', tag:'CRM' },
  { name:'Slack',         desc:'Get hot-lead and needs-human alerts in a Slack channel.', tag:'Alerts' },
  { name:'Zapier',        desc:'Trigger 5,000+ apps when leads enter or change stage.', tag:'Automation' },
];

function IntegrationsTab({ onSave }) {
  return (
    <Section
      title="Integrations"
      description="Connect external tools. All connections shown are placeholders — wire them up after launch."
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {INTEGRATIONS.map((it) => (
          <div key={it.name} className="flex items-start gap-3 rounded-lg border border-slate-800/60 bg-surface/30 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 text-xs font-semibold text-slate-300">
              {it.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-100">{it.name}</span>
                <span className="rounded-full border border-slate-700/60 bg-surface px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">{it.tag}</span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{it.desc}</p>
              <button
                onClick={() => onSave(it.name)}
                className="mt-2 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
              >
                Connect
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 6 — Billing
// ─────────────────────────────────────────────────────────────
function BillingTab() {
  const navigate = useNavigate();
  return (
    <Section
      title="Billing & Plan"
      description="Subscription, invoices, and usage live on the dedicated billing page."
    >
      <div className="flex items-center gap-4 rounded-lg border border-slate-800/60 bg-surface/30 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent2 text-sm font-bold text-white glow-accent">
          P
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-100">Pro Plan · $149 / month</div>
          <div className="text-xs text-slate-500">Renews 1 May 2026 · 5 WhatsApp numbers · 10 team seats</div>
        </div>
      </div>
      <PrimaryButton onClick={() => navigate('/billing')}>
        Manage Billing &amp; Plan →
      </PrimaryButton>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 7 — Account (Email + Password)
// ─────────────────────────────────────────────────────────────
function AccountTab({ showToast }) {
  const { user, setAuth, token, refreshToken, tenant } = useAuthStore();

  // ── Email form ──────────────────────────────────────────────
  const [emailForm, setEmailForm]     = useState({ newEmail: '', currentPassword: '' });
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError]   = useState('');

  const setE = (key) => (e) => setEmailForm((f) => ({ ...f, [key]: e.target.value }));

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setEmailError('');
    if (!emailForm.newEmail.trim()) { setEmailError('Please enter a new email address.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailForm.newEmail)) { setEmailError('Enter a valid email address.'); return; }
    if (!emailForm.currentPassword) { setEmailError('Current password is required to change email.'); return; }
    setEmailSaving(true);
    try {
      const res = await authAPI.changeEmail(emailForm.newEmail.trim().toLowerCase(), emailForm.currentPassword);
      const updated = res?.data ?? res;
      // Update Zustand so the displayed email reflects immediately
      setAuth({ accessToken: token, refreshToken, user: { ...user, email: updated.email }, tenant });
      setEmailForm({ newEmail: '', currentPassword: '' });
      showToast('Email updated ✓');
    } catch (err) {
      setEmailError(err.message || 'Failed to update email.');
    } finally {
      setEmailSaving(false);
    }
  };

  // ── Password form ───────────────────────────────────────────
  const [pwForm, setPwForm]     = useState({ next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError]   = useState('');

  const setP = (key) => (e) => setPwForm((f) => ({ ...f, [key]: e.target.value }));

  const handlePwSubmit = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pwForm.next.length < 8) { setPwError('Password must be at least 8 characters.'); return; }
    if (pwForm.next !== pwForm.confirm) { setPwError('Passwords do not match.'); return; }
    setPwSaving(true);
    try {
      await authAPI.changePassword(pwForm.next);
      setPwForm({ next: '', confirm: '' });
      showToast('Password updated ✓');
    } catch (err) {
      setPwError(err.message || 'Failed to update password.');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current email display */}
      <div className="rounded-xl border border-slate-800/60 bg-surface/40 px-5 py-4">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Current Email</p>
        <p className="text-sm font-medium text-slate-100">{user?.email || '—'}</p>
      </div>

      {/* Update Email */}
      <Section
        title="Update Email"
        description="Change your login email address. Your current password is required to confirm."
        footer={
          <PrimaryButton disabled={emailSaving} onClick={handleEmailSubmit}>
            {emailSaving ? 'Saving…' : 'Update Email'}
          </PrimaryButton>
        }
      >
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <Field label="New Email Address">
            <input
              type="email"
              placeholder="Enter new email"
              value={emailForm.newEmail}
              onChange={setE('newEmail')}
              autoComplete="email"
              className="input-dark w-full rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Current Password" hint="Required to confirm identity">
            <input
              type="password"
              placeholder="Enter your current password"
              value={emailForm.currentPassword}
              onChange={setE('currentPassword')}
              autoComplete="current-password"
              className="input-dark w-full rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          {emailError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{emailError}</p>
          )}
        </form>
      </Section>

      {/* Update Password */}
      <Section
        title="Update Password"
        description="Set a new login password. Minimum 8 characters."
        footer={
          <PrimaryButton disabled={pwSaving} onClick={handlePwSubmit}>
            {pwSaving ? 'Saving…' : 'Update Password'}
          </PrimaryButton>
        }
      >
        <form onSubmit={handlePwSubmit} className="space-y-4">
          <Field label="New Password" hint="Min 8 characters">
            <input
              type="password"
              placeholder="Enter new password"
              value={pwForm.next}
              onChange={setP('next')}
              autoComplete="new-password"
              className="input-dark w-full rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Confirm New Password">
            <input
              type="password"
              placeholder="Confirm new password"
              value={pwForm.confirm}
              onChange={setP('confirm')}
              autoComplete="new-password"
              className="input-dark w-full rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          {pwError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{pwError}</p>
          )}
        </form>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Toast (bottom-right)
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

// ─────────────────────────────────────────────────────────────
// Inline icons
// ─────────────────────────────────────────────────────────────
function svgProps(p) { return { fill:'none', stroke:'currentColor', strokeWidth:1.75, strokeLinecap:'round', strokeLinejoin:'round', viewBox:'0 0 24 24', ...p }; }
function IconWhatsApp(p) { return <svg {...svgProps(p)}><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z"/></svg>; }
function IconSparkles(p) { return <svg {...svgProps(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>; }
function IconTeam(p)     { return <svg {...svgProps(p)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function IconBell(p)     { return <svg {...svgProps(p)}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>; }
function IconPlug(p)     { return <svg {...svgProps(p)}><path d="M12 22v-5M9 8V2M15 8V2M5 8h14v3a7 7 0 0 1-14 0V8Z"/></svg>; }
function IconCard(p)     { return <svg {...svgProps(p)}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>; }
function IconUser(p)     { return <svg {...svgProps(p)}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>; }
