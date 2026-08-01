// src/components/landing/Features.jsx — three-column capability breakdown.
import React from 'react';
import Eyebrow from './Eyebrow';

const FEATURES = [
  {
    icon: '◎',
    title: 'Dual-Agent AI Engine',
    body: 'A Qualifier agent scores and diagnoses every lead. A Closer agent writes the reply. Two specialists instead of one generalist — and the Closer is hard-blocked from inventing facts you never gave it.',
  },
  {
    icon: '◈',
    title: 'Multi-tenant CRM',
    body: 'A full pipeline, contacts, and an activity trail on every lead. Each workspace is isolated at the database layer, so agencies can run many clients side by side.',
  },
  {
    icon: '⬗',
    title: 'Meta Ads Attribution',
    body: 'Server-side Conversions API events fire as leads progress, so your ad reporting reflects real revenue instead of whatever survived the browser.',
  },
];

export default function Features() {
  return (
    <section id="features" aria-labelledby="features-heading">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-14">
          <Eyebrow className="mb-4">What you get</Eyebrow>
          <h2 id="features-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            Everything your sales team <span className="gradient-text">forgets to do</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="glass-card rounded-2xl p-7">
              <span
                aria-hidden="true"
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl mb-5"
                style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
              >
                {feature.icon}
              </span>
              <h3 className="text-lg font-semibold text-slate-100 mb-3">{feature.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
