// src/pages/Settings.jsx — Tenant configuration panel

const { useState } = React;

const ConnectionStatus = ({ connected, label, detail }) => (
  <div className="flex items-center justify-between p-4 rounded-xl"
       style={{ background: connected ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                border: `1px solid ${connected ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
    <div className="flex items-center gap-3">
      <PulseDot color={connected ? '#10b981' : '#ef4444'} />
      <div>
        <div className="text-sm font-semibold" style={{ color: connected ? '#10b981' : '#ef4444' }}>
          {label} — {connected ? 'Connected' : 'Not configured'}
        </div>
        {detail && <div className="text-xs text-slate-500 mt-0.5 font-mono">{detail}</div>}
      </div>
    </div>
    <Button size="sm" variant={connected ? 'ghost' : 'primary'}>
      {connected ? 'Reconfigure' : 'Connect'}
    </Button>
  </div>
);

const SettingsSection = ({ title, subtitle, children }) => (
  <div className="glass-card rounded-2xl p-6">
    <div className="mb-5 pb-4 border-b border-slate-800/50">
      <h3 className="text-sm font-bold text-slate-200">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const Settings = () => {
  const s = MOCK.settings;
  const [tenantName, setTenantName] = useState(s.tenant.name);
  const [waToken, setWaToken]       = useState('');
  const [pixelId, setPixelId]       = useState(s.meta.pixelId);
  const [aiEnabled, setAiEnabled]   = useState(true);
  const [autoClose, setAutoClose]   = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [saved, setSaved]           = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="p-6 space-y-5 page-enter max-w-4xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configure your ASOS workspace</p>
      </div>

      {/* Tenant info */}
      <SettingsSection title="Workspace" subtitle="Your tenant configuration">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Business Name" value={tenantName} onChange={setTenantName} />
          <Input label="Tenant Slug"   value={s.tenant.slug} />
        </div>
        <div className="flex items-center gap-3 mt-4">
          <div className="px-3 py-1.5 rounded-lg text-xs font-bold"
               style={{ background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.25)', color:'#818cf8' }}>
            {s.tenant.plan} PLAN
          </div>
          <span className="text-xs text-slate-500">Plan renews Jan 1, 2025</span>
        </div>
      </SettingsSection>

      {/* WhatsApp */}
      <SettingsSection title="WhatsApp Cloud API" subtitle="Meta WhatsApp Business Platform credentials">
        <ConnectionStatus
          connected={s.whatsapp.connected}
          label="WhatsApp Business"
          detail={s.whatsapp.number}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Input label="Phone Number ID" value={s.whatsapp.phoneId} />
          <Input label="Access Token (encrypted)" value={waToken} onChange={setWaToken}
                 placeholder="EAAxxxxxx…" type="password" />
        </div>
        <div className="flex items-center gap-3 mt-4">
          <Button variant="secondary" size="sm">Send Test Message</Button>
          <span className="text-xs text-slate-600">Sends to your number to verify connection</span>
        </div>
      </SettingsSection>

      {/* Meta Ads */}
      <SettingsSection title="Meta Ads Integration" subtitle="Pixel + Conversions API for attribution">
        <ConnectionStatus
          connected={s.meta.connected}
          label="Meta Pixel + CAPI"
          detail={`Pixel ID: ${s.meta.pixelId}`}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Input label="Meta Pixel ID"    value={pixelId} onChange={setPixelId} />
          <Input label="CAPI Access Token" value="" placeholder="EAAxxxxxx…" type="password" />
        </div>
        <div className="mt-4 p-3 rounded-xl text-xs text-slate-400 leading-relaxed"
             style={{ background:'rgba(99,102,241,0.05)', border:'1px solid rgba(99,102,241,0.1)' }}>
          ℹ Server-side events sent: <strong className="text-indigo-400">Lead</strong>,{' '}
          <strong className="text-indigo-400">CompleteRegistration</strong>,{' '}
          <strong className="text-indigo-400">Purchase</strong> — automatically deduped with browser pixel.
        </div>
      </SettingsSection>

      {/* AI Config */}
      <SettingsSection title="AI Engine" subtitle="Claude AI behaviour settings">
        <div className="space-y-4">
          <Toggle checked={aiEnabled}       onChange={setAiEnabled}   label="Enable AI for new conversations" />
          <Toggle checked={autoClose}       onChange={setAutoClose}   label="Auto-close conversations after 7 days of inactivity" />
          <Toggle checked={notifications}  onChange={setNotifications} label="Alert agent when AI hands off a HOT lead" />
        </div>
        <div className="mt-4 p-4 rounded-xl" style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.12)' }}>
          <div className="text-xs font-semibold text-indigo-400 mb-2">Current AI Model</div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm text-slate-300">claude-3-5-sonnet-20241022</span>
            <Badge label="AI" />
          </div>
          <div className="mt-3 space-y-2">
            <ProgressBar label="Temperature: 0.3 (consistent)" value={30} max={100} color="#8b5cf6" />
            <ProgressBar label="Max Tokens: 512 (concise WA replies)" value={512} max={4096} color="#6366f1" />
          </div>
        </div>
        <div className="mt-4">
          <Button variant="secondary">✏ Edit System Prompt & BANT Criteria</Button>
        </div>
      </SettingsSection>

      {/* Billing */}
      <SettingsSection title="Billing" subtitle="Your current plan and usage">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          {[
            { l:'Current Plan', v:'PRO', c:'#818cf8' },
            { l:'Next Billing', v:'Jan 1, 2025', c:'#94a3b8' },
            { l:'Monthly Amount', v:'$297/mo', c:'#10b981' },
          ].map(({ l, v, c }) => (
            <div key={l} className="p-4 rounded-xl" style={{ background:'rgba(30,41,59,0.5)', border:'1px solid rgba(51,65,85,0.3)' }}>
              <div className="text-xs text-slate-500 mb-1">{l}</div>
              <div className="text-lg font-bold font-mono" style={{ color: c }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <ProgressBar label={`AI Tokens: ${(3_420_000).toLocaleString()} / ${(5_000_000).toLocaleString()}`}
                       value={3420000} max={5000000} color="#6366f1" />
          <ProgressBar label="Contacts: 1,284 / 5,000"
                       value={1284} max={5000} color="#8b5cf6" />
          <ProgressBar label="Messages: 8,920 / 50,000"
                       value={8920} max={50000} color="#06b6d4" />
        </div>
        <div className="flex gap-3 mt-5">
          <Button variant="primary">Upgrade to Enterprise</Button>
          <Button variant="ghost">View Invoices</Button>
        </div>
      </SettingsSection>

      {/* Save */}
      <div className="flex items-center gap-4 pb-6">
        <Button variant="primary" onClick={handleSave}>
          {saved ? '✓ Saved!' : 'Save Changes'}
        </Button>
        <Button variant="ghost">Cancel</Button>
        {saved && <span className="text-xs text-emerald-400 animate-fade-in">Settings saved successfully</span>}
      </div>

    </div>
  );
};

window.SettingsPage = Settings;
