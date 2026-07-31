// src/components/landing/StatsBar.jsx — headline performance numbers.
import React from 'react';

const STATS = [
  { value: '78%',   label: 'AI handling rate' },
  { value: '11.1%', label: 'Conversion rate' },
  { value: '5.68x', label: 'Average ROAS' },
];

export default function StatsBar() {
  return (
    <section aria-label="Performance highlights" className="relative">
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
