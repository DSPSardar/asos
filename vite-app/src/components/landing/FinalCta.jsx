// src/components/landing/FinalCta.jsx — closing ask.
//
// Low-friction framing only: no countdown timers, no invented scarcity.
import React from 'react';
import CtaButton from './CtaButton';
import { SIGNUP_HREF } from './links';

export default function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[38rem] h-[38rem] rounded-full pointer-events-none opacity-20"
        style={{ background: 'radial-gradient(circle,#6366f1,transparent 70%)', filter: 'blur(90px)' }}
      />
      <div className="relative max-w-3xl mx-auto px-6 py-20 md:py-28 text-center">
        <h2 id="cta-heading" className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-5">
          Your next lead is <span className="gradient-text">already waiting</span>
        </h2>
        <p className="text-lg text-slate-300 mb-9 max-w-xl mx-auto leading-relaxed">
          Connect your WhatsApp number and let the agents work your enquiries tonight.
          Set-up takes minutes.
        </p>
        <CtaButton href={SIGNUP_HREF} size="lg">
          Start free trial →
        </CtaButton>
        <p className="mt-5 text-sm text-slate-400">
          14-day free trial · No credit card required · Cancel anytime
        </p>
      </div>
    </section>
  );
}
