// src/components/landing/HowItWorks.jsx — the four-step mechanism.
import React from 'react';
import Eyebrow from './Eyebrow';

const STEPS = [
  {
    n: '01',
    title: 'A lead comes in',
    body: 'From a Meta ad, a WhatsApp message, or an organic signup. Every lead lands in one pipeline.',
  },
  {
    n: '02',
    title: 'AI qualifies and diagnoses',
    body: 'The Qualifier agent scores buying intent and writes down the real problem behind the enquiry.',
  },
  {
    n: '03',
    title: 'A personalised WhatsApp goes out',
    body: 'The Closer agent writes and sends the reply, grounded strictly in the facts you configured.',
  },
  {
    n: '04',
    title: 'The deal closes, tracked end to end',
    body: 'Stage advances, activity is logged, and conversions fire server-side so your ad reporting stays accurate.',
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how"
      aria-labelledby="how-heading"
      className="border-y border-indigo-500/10"
      style={{ background: 'rgba(99,102,241,0.025)' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-14">
          <Eyebrow className="mb-4">How it works</Eyebrow>
          <h2 id="how-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            From ad click to <span className="gradient-text">closed deal</span>
          </h2>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((step) => (
            <li key={step.n} className="glass-card rounded-2xl p-6">
              <span className="block text-sm font-mono font-semibold text-indigo-400 mb-3">
                {step.n}
              </span>
              <h3 className="text-base font-semibold text-slate-100 mb-2">{step.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
