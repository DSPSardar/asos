// src/pages/Onboarding.jsx — 5-step setup wizard (route: /onboarding).
// Stub per Phase 1 — UI shell + placeholder step bodies.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@pages/Layout';

const STEPS = [
  { id:1, key:'whatsapp', title:'Connect WhatsApp',     blurb:'Link your WhatsApp Business number via Meta Cloud API.' },
  { id:2, key:'ai',       title:'Configure AI',         blurb:'Pick a model and set your system prompt for sales replies.' },
  { id:3, key:'leads',    title:'Import sample leads',  blurb:'Upload a CSV or skip and start from inbound only.' },
  { id:4, key:'test',     title:'Send a test message',  blurb:'Verify the AI pipeline with a test message to your phone.' },
  { id:5, key:'live',     title:'Go live',              blurb:'Review your setup and switch on AI auto-replies.' },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [completed, setCompleted] = useState(new Set());
  const [skipping, setSkipping] = useState(false);

  const next = () => {
    setCompleted((s) => new Set(s).add(step));
    if (step < STEPS.length) setStep(step + 1);
    else {
      // Final step: go live
      alert('Demo: AI auto-replies would now be enabled. Workspace marked as live.');
      navigate('/dashboard', { replace: true });
    }
  };
  const prev = () => step > 1 && setStep(step - 1);
  const jumpTo = (id) => setStep(id);

  const current = STEPS[step - 1];

  return (
    <>
      <PageHeader
        title="Welcome to ASOS"
        subtitle="Let's get your AI sales bot live in under 5 minutes."
        action={
          <button
            onClick={() => setSkipping(true)}
            className="text-xs text-slate-500 transition-colors hover:text-accent"
          >
            Skip onboarding →
          </button>
        }
      />

      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Stepper step={step} completed={completed} onJump={jumpTo} />

        <section className="glass-card overflow-hidden rounded-xl">
          <header className="flex items-center justify-between border-b border-slate-800/60 px-6 py-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-accent">Step {current.id} of {STEPS.length}</div>
              <h2 className="mt-0.5 text-base font-semibold tracking-tight text-slate-100">{current.title}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{current.blurb}</p>
            </div>
            {completed.has(step) && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                <span className="h-1 w-1 rounded-full bg-emerald-400" /> Done
              </span>
            )}
          </header>

          <div className="p-6">
            <StepBody stepKey={current.key} />
          </div>

          <footer className="flex items-center justify-between border-t border-slate-800/60 bg-surface/40 px-6 py-3">
            <button
              onClick={prev}
              disabled={step === 1}
              className="rounded-lg border border-slate-700/60 bg-transparent px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-surface2/60 disabled:cursor-not-allowed disabled:opacity-30"
            >
              ← Back
            </button>
            <div className="text-[11px] text-slate-500">
              {step < STEPS.length ? `Next: ${STEPS[step].title}` : 'Last step'}
            </div>
            <button
              onClick={next}
              className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3.5 py-2 text-xs font-medium text-white shadow-md shadow-accent/20 transition-transform hover:scale-[1.02]"
            >
              {step < STEPS.length ? 'Continue →' : 'Go live ✓'}
            </button>
          </footer>
        </section>

        <p className="text-center text-[11px] text-slate-600">
          Need help? <a href="mailto:support@asos.io" className="text-slate-400 hover:text-accent">support@asos.io</a>
        </p>
      </div>

      {skipping && (
        <SkipModal
          onClose={() => setSkipping(false)}
          onConfirm={() => { setSkipping(false); navigate('/dashboard', { replace: true }); }}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Stepper (horizontal, click to jump)
// ─────────────────────────────────────────────────────────────
function Stepper({ step, completed, onJump }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const isActive = step === s.id;
        const isDone   = completed.has(s.id);
        return (
          <React.Fragment key={s.id}>
            <li className="flex-1">
              <button
                onClick={() => onJump(s.id)}
                className={`group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${
                  isActive
                    ? 'border-accent/50 bg-accent/10 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                    : isDone
                      ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10'
                      : 'border-slate-800/60 bg-surface/30 hover:border-slate-700'
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  isActive
                    ? 'bg-accent text-white shadow-md shadow-accent/30'
                    : isDone
                      ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                      : 'bg-slate-800 text-slate-500'
                }`}>
                  {isDone ? '✓' : s.id}
                </span>
                <span className={`hidden truncate text-xs font-medium md:inline ${
                  isActive ? 'text-slate-100' : isDone ? 'text-emerald-300' : 'text-slate-500'
                }`}>{s.title}</span>
              </button>
            </li>
            {i < STEPS.length - 1 && <span className="hidden h-px w-3 bg-slate-800 md:block" />}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────
// Step bodies (placeholder content — full UIs to be built later)
// ─────────────────────────────────────────────────────────────
function StepBody({ stepKey }) {
  switch (stepKey) {
    case 'whatsapp':
      return (
        <div className="space-y-4">
          <Placeholder
            title="Link your WhatsApp Business number"
            body="In the full version, this step walks you through the Meta Developer App setup, captures your Phone Number ID + Access Token, and verifies the webhook. For now, you can add credentials manually under Settings → WhatsApp."
            cta="Open Settings → WhatsApp"
            ctaHref="/settings"
          />
        </div>
      );
    case 'ai':
      return (
        <div className="space-y-4">
          <Placeholder
            title="Pick your AI model and write a system prompt"
            body="Default model is Claude Sonnet 4.6. We pre-fill a Pakistan real estate sales prompt with Urdu+English style and DHA pricing references — you can refine it per your business."
            cta="Open Settings → AI"
            ctaHref="/settings"
          />
        </div>
      );
    case 'leads':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DropZone />
            <ChoiceCard
              title="Skip — I'll start from inbound"
              body="New conversations from your WhatsApp ads or organic messages will start populating the inbox automatically."
            />
          </div>
        </div>
      );
    case 'test':
      return (
        <div className="space-y-4">
          <Placeholder
            title="Send a test message to your own phone"
            body="In the full wizard, we ping your verified test number with a sample inbound, run it through Qualifier + Closer, and surface the AI response inline so you can confirm the pipeline is wired."
            cta="Trigger test (demo)"
            onClick={() => alert('Demo: test message sent to +92 340 0821252 (no real send)')}
          />
        </div>
      );
    case 'live':
      return (
        <div className="space-y-4">
          <ReviewCard />
        </div>
      );
    default:
      return <Placeholder title="Coming soon" body="This step isn't built yet." />;
  }
}

function Placeholder({ title, body, cta, ctaHref, onClick }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700/60 bg-surface/20 px-5 py-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-slate-700">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5 text-slate-500">
          <circle cx="12" cy="12" r="9" /><path d="M9 9h6M9 13h4" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">{body}</p>
      {cta && (
        ctaHref
          ? <a href={ctaHref} className="mt-4 inline-block rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20">{cta}</a>
          : <button onClick={onClick} className="mt-4 rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20">{cta}</button>
      )}
    </div>
  );
}

function DropZone() {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700/60 bg-surface/20 px-5 py-8 text-center transition-colors hover:border-accent/40 hover:bg-accent/5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-slate-500">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
      </svg>
      <div className="text-sm font-medium text-slate-200">Upload leads CSV</div>
      <div className="text-[11px] text-slate-500">Drop a file or click to browse · max 10 MB</div>
      <input type="file" accept=".csv" className="hidden" onChange={() => alert('Demo: CSV upload would parse and preview rows.')} />
    </label>
  );
}

function ChoiceCard({ title, body }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-800/60 bg-surface/30 px-5 py-8 text-center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-slate-500">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z" />
      </svg>
      <div className="text-sm font-medium text-slate-200">{title}</div>
      <p className="max-w-xs text-[11px] leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

function ReviewCard() {
  const checks = [
    { label:'WhatsApp number connected',   ok:true,  note:'+92 340 0821252' },
    { label:'AI configuration set',         ok:true,  note:'Claude Sonnet 4.6 · Urdu+English · Professional tone' },
    { label:'Handoff rules enabled',        ok:true,  note:'Payment / unanswered / legal triggers ON' },
    { label:'Test message verified',        ok:true,  note:'Round-trip succeeded · 1.4s end-to-end' },
    { label:'Billing on file',              ok:true,  note:'Pro Plan · Visa •••• 4242' },
  ];
  return (
    <div className="rounded-lg border border-slate-800/60 bg-surface/30 p-5">
      <h3 className="text-sm font-semibold text-slate-100">Pre-launch checklist</h3>
      <ul className="mt-3 space-y-2">
        {checks.map((c, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${c.ok ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40' : 'bg-slate-800 text-slate-500'}`}>
              {c.ok ? '✓' : '–'}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-200">{c.label}</div>
              <div className="text-[11px] text-slate-500">{c.note}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] text-accent">
        Click <strong>Go live ✓</strong> to enable AI auto-replies on every inbound WhatsApp message.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Skip onboarding modal
// ─────────────────────────────────────────────────────────────
function SkipModal({ onClose, onConfirm }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glass-card w-full max-w-md rounded-2xl p-6">
        <h2 className="text-base font-semibold tracking-tight text-slate-100">Skip onboarding?</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          You can come back to <code className="rounded bg-surface2 px-1 py-0.5 font-mono text-slate-300">/onboarding</code> any time. Until you complete it, AI auto-replies stay <span className="text-amber-300">paused</span> — your dashboard shows demo data only.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-700/60 bg-transparent px-3 py-2 text-xs text-slate-300 hover:bg-surface2/60">
            Continue setup
          </button>
          <button onClick={onConfirm} className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3 py-2 text-xs font-medium text-white shadow-md shadow-accent/20">
            Go to dashboard →
          </button>
        </div>
      </div>
    </div>
  );
}
