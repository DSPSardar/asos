// src/components/landing/Pricing.jsx — four-tier pricing with a billing toggle.
//
// Prices mirror src/pages/Billing.jsx (PLANS, line 9), which is the
// in-app source of truth. If you change a number here, change it there
// too — a landing page that contradicts the billing screen loses trust
// at exactly the wrong moment.
import React, { useState } from 'react';
import CtaButton from './CtaButton';
import Eyebrow from './Eyebrow';
import { SIGNUP_HREF } from './links';

const PLANS = [
  {
    name: 'Starter',
    monthly: 29,
    yearlyPerMonth: 23,
    yearlyTotal: 276,
    blurb: 'For solo founders starting with WhatsApp sales automation.',
    features: ['500 contacts', '2,000 AI messages/mo', '1 WhatsApp number', 'Basic analytics', 'Email support'],
    featured: false,
  },
  {
    name: 'Growth',
    monthly: 79,
    yearlyPerMonth: 63,
    yearlyTotal: 756,
    blurb: 'For small teams running active Meta Ad campaigns.',
    features: ['2,500 contacts', '10,000 AI messages/mo', '2 WhatsApp numbers', 'Full analytics', 'Chat support'],
    featured: false,
  },
  {
    name: 'Pro',
    monthly: 149,
    yearlyPerMonth: 119,
    yearlyTotal: 1428,
    blurb: 'For sales teams scaling WhatsApp and Meta into a revenue engine.',
    features: ['10,000 contacts', '50,000 AI messages/mo', '5 WhatsApp numbers', 'Meta CAPI attribution', 'Priority support'],
    featured: true,
  },
  {
    name: 'Agency',
    monthly: 349,
    yearlyPerMonth: 279,
    yearlyTotal: 3348,
    blurb: 'For agencies reselling AI sales automation under their own brand.',
    features: ['Unlimited contacts', '250,000 AI messages/mo', '25 WhatsApp numbers', 'White-label workspaces', 'Dedicated support'],
    featured: false,
  },
];

export default function Pricing() {
  const [cycle, setCycle] = useState('monthly');
  const yearly = cycle === 'yearly';

  return (
    <section id="pricing" aria-labelledby="pricing-heading">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-10">
          <Eyebrow className="mb-4">Pricing</Eyebrow>
          <h2 id="pricing-heading" className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">
            Plans that pay for <span className="gradient-text">themselves</span>
          </h2>
          <p className="text-slate-300">
            Every plan starts with a 14-day free trial. No credit card required.
          </p>
        </div>

        {/* Billing cycle toggle */}
        <div
          className="flex justify-center mb-12"
          role="group"
          aria-label="Billing cycle"
        >
          <div className="inline-flex p-1 rounded-xl border border-indigo-500/15" style={{ background: 'rgba(15,23,42,0.6)' }}>
            {[
              ['monthly', 'Monthly'],
              ['yearly', 'Yearly'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={cycle === value}
                onClick={() => setCycle(value)}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  cycle === value ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                style={cycle === value ? { background: 'linear-gradient(135deg,rgba(99,102,241,0.25),rgba(139,92,246,0.2))' } : undefined}
              >
                {label}
                {/* Explicit space: JSX drops whitespace between two expression
                    children, so without it the accessible name of this button
                    reads "Yearlysave 20%". */}
                {value === 'yearly' && (
                  <>
                    {' '}
                    <span className="ml-2 text-[10px] font-mono text-emerald-400">save 20%</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              className={`glass-card rounded-2xl p-6 flex flex-col ${
                plan.featured ? 'border-indigo-400/40 lg:-mt-3 lg:pb-9' : ''
              }`}
              style={plan.featured ? { borderColor: 'rgba(129,140,248,0.4)' } : undefined}
            >
              {plan.featured && (
                <span className="self-start mb-3 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-200 bg-indigo-500/20 border border-indigo-400/30">
                  Most popular
                </span>
              )}

              <h3 className="text-lg font-semibold text-slate-100">{plan.name}</h3>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold font-mono text-white">
                  ${yearly ? plan.yearlyPerMonth : plan.monthly}
                </span>
                <span className="text-sm text-slate-400">/month</span>
              </div>
              <p className="mt-1 text-xs text-slate-400 font-mono h-4">
                {yearly ? `billed annually — $${plan.yearlyTotal.toLocaleString()}/yr` : ''}
              </p>

              <p className="mt-4 text-sm text-slate-400 leading-relaxed">{plan.blurb}</p>

              <ul className="mt-5 space-y-2.5 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-slate-300">
                    <span aria-hidden="true" className="text-indigo-400 mt-0.5">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>

              <CtaButton
                href={SIGNUP_HREF}
                variant={plan.featured ? 'primary' : 'secondary'}
                className="mt-7 block w-full"
              >
                Start free trial
              </CtaButton>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-slate-400">
          All plans include the full dual-agent engine. Upgrade, downgrade or cancel at any time.
        </p>
      </div>
    </section>
  );
}
