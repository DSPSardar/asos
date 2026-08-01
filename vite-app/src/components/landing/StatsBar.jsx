import React from 'react';

// src/components/landing/StatsBar.jsx — headline capability claims.
//
// These are statements about how the system works, not measured customer
// outcomes. The previous values (78% / 11.1% / 5.68x) were demo fixtures
// copied from frontend/src/lib/api.js — the 78% was a forecast-confidence
// field relabelled as an AI handling rate. Publishing unsubstantiated
// performance numbers on a page that receives paid traffic is a liability,
// so they are gone. Replace this block with real aggregates only when you
// can source them from production and state the sample and period.
const STATS = [
  { value: '24/7',   label: 'Replies day and night' },
  { value: '2',      label: 'Agents per lead — one qualifies, one closes' },
  { value: 'CAPI',   label: 'Server-side ad attribution' },
];

export default function StatsBar() {
  return (
    <section aria-label="How it works at a glance" className="relative">
      <div className="max-w-6xl mx-auto px-6 pb-16 md:pb-20">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="glass-card rounded-2xl px-6 py-8 text-center"
            >
              <dt className="sr-only">{stat.label}</dt>
              <dd>
                <span className="block text-4xl md:text-5xl font-bold font-mono gradient-text">
                  {stat.value}
                </span>
                <span className="block mt-2 text-sm text-slate-400">{stat.label}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
