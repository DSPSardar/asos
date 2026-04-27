// src/pages/Settings.jsx — Settings (route: /settings).
// Left tab nav + right content panel. 6 tabs.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@pages/Layout';

const TABS = [
  { id:'whatsapp',      label:'WhatsApp',         icon:IconWhatsApp,    desc:'Connect your WhatsApp Business number and test the connection.' },
  { id:'ai',            label:'AI Configuration', icon:IconSparkles,    desc:'System prompt, model selection, and AI→human handoff rules.' },
  { id:'team',          label:'Team',             icon:IconTeam,        desc:'Invite teammates and manage roles.' },
  { id:'notifications', label:'Notifications',    icon:IconBell,        desc:'Email and WhatsApp alerts on lead activity.' },
  { id:'integrations',  label:'Integrations',     icon:IconPlug,        desc:'Connect external tools (CRM, Sheets, Slack).' },
  { id:'billing',       label:'Billing & Plan',   icon:IconCard,        desc:'Manage your subscription and view invoices.' },
];

const DEFAULT_AI_PROMPT = `You are an AI investment advisor for Boulevard Tower REIT, a Shariah-compliant Real Estate Investment Trust in Pakistan listed on PSX as BTREIT. We hold premium commercial assets across Karachi, Lahore, and Islamabad. Your role is to qualify inbound WhatsApp inquiries, explain the REIT structure and dividend mechanics, and book consultation calls with our licensed advisors.

COMMUNICATION STYLE
Mix Urdu and English naturally — typical urban Pakistani professional register. Be respectful (use bhai / bhabi / sir / madam / sahab). Always greet with "Walaikum assalam" if the customer opens with salam.

QUALIFY EVERY LEAD ON
1. Investment amount (minimum entry PKR 1 lakh)
2. Goal (income / growth / both)
3. Horizon (short-term / 3–5 yr / long-term)
4. Profile (resident Pakistani / overseas / corporate treasury)

KEY FACTS TO REFERENCE
- Minimum investment: PKR 1,00,000 (1 lakh)
- Quarterly dividends: target 9–11% annualized (paid Mar / Jun / Sep / Dec)
- Capital appreciation: target 6–8% annualized over 5 years
- Shariah-compliant: certified by the Mufti Taqi Usmani office
- Listed on Pakistan Stock Exchange as BTREIT
- Underlying assets: Boulevard One (Karachi commercial), Boulevard Plaza (Lahore retail), Boulevard Centre (Islamabad office)
- Occupancy: 94% as of last quarter
- Overseas Pakistanis: Roshan Digital Account compatible for direct subscription

ALWAYS OFFER A CONSULTATION CALL after qualifying. Our licensed advisors handle KYC, CDC account, and remittance instructions.

ESCALATE TO SAAD (manager) IMMEDIATELY WHEN
- Investor mentions payment / remittance dispute or refund
- Legal or regulatory questions (SECP, FBR, taxation)
- Custom institutional pricing or units > PKR 5 cr
- Shariah-compliance objections requiring Mufti review
- Any HOT lead has reached PROPOSAL stage`;

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
          {tab === 'whatsapp'      && <WhatsAppTab      onSave={() => showToast('WhatsApp settings saved ✓')} />}
          {tab === 'ai'            && <AITab            onSave={() => showToast('AI configuration saved ✓')} />}
          {tab === 'team'          && <TeamTab          onSave={() => showToast('Team updated ✓')} />}
          {tab === 'notifications' && <NotificationsTab onSave={() => showToast('Notification preferences saved ✓')} />}
          {tab === 'integrations'  && <IntegrationsTab  onSave={(name) => showToast(`${name} connection demo ✓`)} />}
          {tab === 'billing'       && <BillingTab />}
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
// TAB 1 — WhatsApp
// ─────────────────────────────────────────────────────────────
function WhatsAppTab({ onSave }) {
  const [revealToken, setRevealToken] = useState(false);
  const [testPhone,  setTestPhone]    = useState('+92 333 ');
  const [testResult, setTestResult]   = useState(null);
  const [sending,    setSending]      = useState(false);
  const phoneId      = '102345987612345';
  const accessToken  = 'EAAGm0PX4ZCpsBO0Z****************************************************jK7Lz2yQX';
  const webhookUrl   = 'https://api.boulevardtower.pk/webhooks/whatsapp';

  const sendTest = (e) => {
    e.preventDefault();
    setSending(true);
    setTestResult(null);
    setTimeout(() => {
      setSending(false);
      setTestResult({ ok: true, msg: `Test message sent to ${testPhone.trim()} successfully (demo).` });
    }, 900);
  };

  const copy = (text) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
  };

  return (
    <>
      <Section
        title="WhatsApp Business Connection"
        description="Connected via Meta Cloud API. Inbound messages are routed to the AI worker."
        footer={<SecondaryButton tone="danger" onClick={() => alert('Demo: would disconnect WhatsApp')}>Disconnect</SecondaryButton>}
      >
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-emerald-300">Connected</div>
            <div className="text-xs tabular-nums text-emerald-300/70">+92 340 0821252 · Boulevard Tower REIT</div>
          </div>
        </div>

        <Field label="Phone Number ID" hint="Read-only">
          <input readOnly value={phoneId} className="input-dark w-full rounded-lg px-3 py-2 text-sm tabular-nums text-slate-300" />
        </Field>

        <Field label="Access Token" hint={revealToken ? 'Visible' : 'Masked'}>
          <div className="relative">
            <input
              readOnly
              value={revealToken ? accessToken.replace(/\*/g, 'X') : accessToken}
              className="input-dark w-full rounded-lg px-3 py-2 pr-20 text-sm tabular-nums text-slate-300"
            />
            <button
              type="button"
              onClick={() => setRevealToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/10"
            >
              {revealToken ? 'Hide' : 'Reveal'}
            </button>
          </div>
        </Field>

        <Field label="Webhook URL" hint="Configure this in Meta Developer Console">
          <div className="relative">
            <input readOnly value={webhookUrl} className="input-dark w-full rounded-lg px-3 py-2 pr-16 text-sm text-slate-300" />
            <button
              type="button"
              onClick={() => { copy(webhookUrl); onSave(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/10"
            >
              Copy
            </button>
          </div>
        </Field>
      </Section>

      <Section title="Send Test Message" description="Sends a one-line test from your business number. Use a verified test recipient.">
        <form onSubmit={sendTest} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Recipient phone (+92 format)">
            <input required value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+92 333 1234567"
              className="input-dark w-full rounded-lg px-3 py-2 text-sm tabular-nums" />
          </Field>
          <PrimaryButton type="submit">{sending ? 'Sending…' : 'Send Test'}</PrimaryButton>
        </form>
        {testResult && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${testResult.ok
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
            {testResult.msg}
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          Need help connecting? <a href="mailto:support@asos.io" className="text-accent hover:underline">Contact support →</a>
        </p>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 2 — AI Configuration
// ─────────────────────────────────────────────────────────────
function AITab({ onSave }) {
  const [model,    setModel]    = useState('claude-sonnet-4-6');
  const [prompt,   setPrompt]   = useState(DEFAULT_AI_PROMPT);
  const [tone,     setTone]     = useState('Professional');
  const [language, setLanguage] = useState('Urdu+English');
  const [budget,   setBudget]   = useState(200);
  const [rules, setRules] = useState({
    payment: true,
    unanswered: true,
    legal: true,
    hotProposal: false,
  });
  const used = 42.18;
  const pct  = Math.min(100, Math.round((used / budget) * 100));

  return (
    <>
      <Section
        title="AI Configuration"
        description="Tune the dual-agent (Qualifier + Closer) behavior for your tenant."
        footer={<PrimaryButton onClick={onSave}>Save Changes</PrimaryButton>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Model">
            <select value={model} onChange={(e) => setModel(e.target.value)} className="input-dark w-full cursor-pointer rounded-lg px-3 py-2 text-sm">
              <option value="claude-opus-4-7">Claude Opus 4.7 — most capable, slowest</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6 — balanced (default)</option>
              <option value="claude-haiku-4-5">Claude Haiku 4.5 — fast, cheap</option>
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
            <span className="text-slate-300">Usage this month</span>
            <span className="tabular-nums text-slate-400">${used.toFixed(2)} / ${budget} ({pct}%)</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-accent to-accent2 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Handoff Rules"
        description="When any toggled rule fires, AI pauses and the conversation is flagged 'Needs human' in the inbox."
        footer={<PrimaryButton onClick={onSave}>Save Changes</PrimaryButton>}
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
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 3 — Team
// ─────────────────────────────────────────────────────────────
const TEAM = [
  { id:'u1', name:'Saad Ali',     email:'saad@boulevardtower.pk',    role:'Admin',   lastActive:'2m ago',   avatar:'SA' },
  { id:'u2', name:'Hira Ahmed',   email:'hira@boulevardtower.pk',    role:'Manager', lastActive:'18m ago',  avatar:'HA' },
  { id:'u3', name:'Bilal Ahmed',  email:'bilal@boulevardtower.pk',   role:'Agent',   lastActive:'1h ago',   avatar:'BA' },
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
        <div className="overflow-hidden rounded-lg border border-slate-800/60">
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
              placeholder="ahmed@boulevardtower.pk" className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
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
function NotificationsTab({ onSave }) {
  const [prefs, setPrefs] = useState({
    newLead:    { email:true,  whatsapp:false },
    hotLead:    { email:true,  whatsapp:true  },
    needsHuman: { email:true,  whatsapp:true  },
    daily:      { email:true,  whatsapp:false },
    weekly:     { email:true,  whatsapp:false },
  });

  const items = [
    { key:'newLead',    label:'New lead',         desc:'Fires when any new contact starts a conversation.' },
    { key:'hotLead',    label:'Hot lead',         desc:'Fires when AI scores a lead as HOT.' },
    { key:'needsHuman', label:'Needs human',      desc:'Fires when AI escalates per your handoff rules.' },
    { key:'daily',      label:'Daily digest',     desc:'9 AM PKT summary: new leads, conversion rate, AI cost.' },
    { key:'weekly',     label:'Weekly report',    desc:'Monday 9 AM: pipeline change, won/lost, AI performance.' },
  ];

  const flip = (key, channel) => setPrefs({ ...prefs, [key]: { ...prefs[key], [channel]: !prefs[key][channel] } });

  return (
    <Section
      title="Alerts"
      description="Choose which events notify you, and on which channel."
      footer={<PrimaryButton onClick={onSave}>Save Preferences</PrimaryButton>}
    >
      <div className="overflow-hidden rounded-lg border border-slate-800/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface/40 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2 font-semibold">Event</th>
              <th className="w-28 px-4 py-2 text-center font-semibold">Email</th>
              <th className="w-28 px-4 py-2 text-center font-semibold">WhatsApp</th>
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
                  <Checkbox on={prefs[it.key].email}    onChange={() => flip(it.key, 'email')} />
                </td>
                <td className="px-4 py-3 text-center">
                  <Checkbox on={prefs[it.key].whatsapp} onChange={() => flip(it.key, 'whatsapp')} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
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
          <div className="text-sm font-semibold text-slate-100">Pro Plan · $99 / month</div>
          <div className="text-xs text-slate-500">Renews 1 May 2026 · 3 team seats included</div>
        </div>
      </div>
      <PrimaryButton onClick={() => navigate('/billing')}>
        Manage Billing &amp; Plan →
      </PrimaryButton>
    </Section>
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
