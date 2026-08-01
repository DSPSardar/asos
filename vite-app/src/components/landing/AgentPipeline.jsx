// src/components/landing/AgentPipeline.jsx — animated replay of one lead
// qualification.
//
// This is a SIMULATED demo on a fixed script. It never represents real
// customer traffic and must never be relabelled to imply that it does.
//
// Field names mirror the live agent contract so the animation doubles as
// documentation:
//   Qualifier -> backend/src/services/claude.service.js:50  (QUALIFIER_SCHEMA)
//   Closer    -> backend/src/services/claude.service.js:228 (CLOSER_SCHEMA)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Eyebrow from './Eyebrow';

const INBOUND_MESSAGE =
  "We get maybe 200 enquiries a month but my team only calls back about 30 of them. The rest just go cold.";

// Qualifier `score` is 1-10 (claude.service.js:55). Lead.aiScore is /100
// (claude.service.js:153). Both are shown, labelled distinctly.
const QUALIFIER_FIELDS = [
  { key: 'lead_status',     value: 'HOT',                                                            tone: 'hot'  },
  { key: 'score',           value: '9/10',                                                           tone: 'plain' },
  { key: 'intent',          value: 'high',                                                           tone: 'plain' },
  { key: 'problem_summary', value: '170 enquiries a month go unworked because follow-up is manual.',  tone: 'plain' },
  { key: 'next_action',     value: 'send_proposal',                                                  tone: 'accent' },
];

const CLOSER_REPLY =
  'Based on your answers, I can see this is costing you ~$40k/month in lost leads. Let me show you how we fix this…';

const STAGES = ['NEW', 'QUALIFYING', 'DIAGNOSED'];

// Step timeline. Total ~12s, then a 2s hold before looping.
const TYPING_MS = 22;           // per character
const FIELD_INTERVAL_MS = 800;  // between Qualifier fields
const HOLD_MS = 2000;

export default function AgentPipeline() {
  // step: 0 idle -> 1 inbound -> 2 qualifier -> 3 closer -> 4 crm -> 5 hold
  const [step, setStep]           = useState(0);
  const [fieldCount, setFieldCnt] = useState(0);
  const [typed, setTyped]         = useState('');
  const [stageIdx, setStageIdx]   = useState(0);
  const [score, setScore]         = useState(0);
  const [reduced, setReduced]     = useState(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const sectionRef = useRef(null);
  const timers     = useRef([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const after = useCallback((ms, fn) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // Jump straight to the finished state — used for reduced motion and as
  // the resting state after each loop.
  const showFinalState = useCallback(() => {
    clearTimers();
    setStep(4);
    setFieldCnt(QUALIFIER_FIELDS.length);
    setTyped(CLOSER_REPLY);
    setStageIdx(STAGES.length - 1);
    setScore(91);
  }, [clearTimers]);

  const runCycle = useCallback(() => {
    clearTimers();
    setStep(1);
    setFieldCnt(0);
    setTyped('');
    setStageIdx(0);
    setScore(0);

    // Step 2 — Qualifier fields populate one at a time.
    after(1600, () => {
      setStep(2);
      QUALIFIER_FIELDS.forEach((_, i) => {
        after(1600 + i * FIELD_INTERVAL_MS, () => setFieldCnt(i + 1));
      });
    });

    const qualifierDone = 1600 + QUALIFIER_FIELDS.length * FIELD_INTERVAL_MS;

    // Step 3 — Closer types its reply.
    after(qualifierDone, () => {
      setStep(3);
      for (let i = 1; i <= CLOSER_REPLY.length; i += 1) {
        after(qualifierDone + i * TYPING_MS, () => setTyped(CLOSER_REPLY.slice(0, i)));
      }
    });

    const closerDone = qualifierDone + CLOSER_REPLY.length * TYPING_MS + 400;

    // Step 4 — CRM stage advances and the lead score counts up.
    after(closerDone, () => {
      setStep(4);
      STAGES.forEach((_, i) => after(closerDone + i * 420, () => setStageIdx(i)));
      for (let v = 0; v <= 91; v += 7) {
        after(closerDone + 300 + (v / 7) * 45, () => setScore(Math.min(v, 91)));
      }
      after(closerDone + 300 + 14 * 45, () => setScore(91));
    });

    // Loop.
    after(closerDone + 2200 + HOLD_MS, runCycle);
  }, [after, clearTimers]);

  // Respect the user's motion preference.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Only animate while the section is on screen.
  useEffect(() => {
    if (reduced) {
      showFinalState();
      return undefined;
    }
    const node = sectionRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) runCycle();
        else clearTimers();
      },
      { threshold: 0.25 }
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      clearTimers();
    };
  }, [reduced, runCycle, clearTimers, showFinalState]);

  return (
    <section
      id="demo"
      ref={sectionRef}
      aria-labelledby="demo-heading"
      className="border-y border-indigo-500/10"
      style={{ background: 'rgba(99,102,241,0.025)' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-12">
          <Eyebrow className="mb-4">Simulated demo</Eyebrow>
          <h2 id="demo-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">
            Watch the agents <span className="gradient-text">work a lead</span>
          </h2>
          <p className="max-w-2xl mx-auto text-slate-300">
            One enquiry, start to finish. This is a scripted example — not live customer data.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Inbound message ── */}
          <div className="glass-card rounded-2xl p-6 min-h-[150px]">
            <Label>Inbound · WhatsApp</Label>
            <div
              className={`mt-4 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-slate-200 leading-relaxed transition-opacity duration-500 ${
                step >= 1 ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ background: 'rgba(30,41,59,0.9)' }}
            >
              {INBOUND_MESSAGE}
            </div>
          </div>

          {/* ── Qualifier ── */}
          <div className="glass-card rounded-2xl p-6 min-h-[150px]">
            <Label>
              Qualifier agent
              <Dot active={step === 2} />
            </Label>
            <dl className="mt-4 space-y-2 font-mono text-xs">
              {QUALIFIER_FIELDS.map((field, i) => (
                <div
                  key={field.key}
                  className={`flex items-start gap-3 transition-all duration-300 ${
                    i < fieldCount ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
                  }`}
                >
                  <dt className="text-slate-500 w-36 flex-shrink-0">{field.key}</dt>
                  <dd className={valueClass(field.tone)}>{field.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* ── Closer ── */}
          <div className="glass-card rounded-2xl p-6 min-h-[170px]">
            <Label>
              Closer agent
              <Dot active={step === 3} />
            </Label>
            <div className="mt-4">
              <div className="font-mono text-xs text-slate-500 mb-2">reply_message</div>
              {/* aria-live off + full text in the DOM: assistive tech reads
                  the finished sentence once, not one character at a time. */}
              <p
                aria-live="off"
                className="rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-slate-100 leading-relaxed min-h-[124px] md:min-h-[76px]"
                style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)' }}
              >
                <span aria-hidden="true">{typed}</span>
                <span className="sr-only">{CLOSER_REPLY}</span>
                {step === 3 && typed.length < CLOSER_REPLY.length && (
                  <span aria-hidden="true" className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-indigo-400 animate-pulse" />
                )}
              </p>
              <div className="mt-3 font-mono text-xs flex items-center gap-3">
                <span className="text-slate-500">closing_type</span>
                <span className={valueClass('accent')}>urgent</span>
              </div>
            </div>
          </div>

          {/* ── CRM ── */}
          <div className="glass-card rounded-2xl p-6 min-h-[170px]">
            <Label>
              CRM
              <Dot active={step === 4} />
            </Label>

            <div className="mt-5 flex items-center gap-2">
              {STAGES.map((stage, i) => (
                <React.Fragment key={stage}>
                  {i > 0 && <span aria-hidden="true" className="text-slate-600 text-xs">→</span>}
                  <span
                    className={`px-3 py-1.5 rounded-full text-[11px] font-mono font-semibold transition-colors duration-300 ${
                      i <= stageIdx
                        ? 'text-indigo-200 border border-indigo-400/40 bg-indigo-500/15'
                        : 'text-slate-500 border border-slate-700/60'
                    }`}
                  >
                    {stage}
                  </span>
                </React.Fragment>
              ))}
            </div>

            <div className="mt-6 flex items-baseline gap-3">
              <span className="text-3xl font-bold font-mono gradient-text">{score}</span>
              <span className="text-sm text-slate-400">/ 100 lead score</span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            type="button"
            onClick={reduced ? showFinalState : runCycle}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-200 border border-indigo-500/25 bg-slate-900/60 hover:border-indigo-400/50 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            ↻ Replay
          </button>
          <p className="text-xs text-slate-400 font-mono">
            Simulated demo · not live customer data
          </p>
        </div>
      </div>
    </section>
  );
}

function Label({ children }) {
  return (
    <Eyebrow as="div" className="flex items-center gap-2">
      {children}
    </Eyebrow>
  );
}

function Dot({ active }) {
  if (!active) return null;
  return (
    <span aria-hidden="true" className="relative flex w-2 h-2 ml-1">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-500" />
    </span>
  );
}

function valueClass(tone) {
  if (tone === 'hot')    return 'text-red-400 font-semibold';
  if (tone === 'accent') return 'text-indigo-300 font-semibold';
  return 'text-slate-200';
}
