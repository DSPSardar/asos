// src/components/landing/Hero.jsx — above-the-fold pitch.
import React from 'react';
import CtaButton from './CtaButton';
import Eyebrow from './Eyebrow';
import { SIGNUP_HREF } from './links';

export default function Hero() {
  return (
    <section className="relative overflow-hidden grid-bg" aria-labelledby="hero-heading">
      {/* Decorative background orbs — mirror the /auth page treatment. */}
      <div
        aria-hidden="true"
        className="absolute -top-32 -left-24 w-96 h-96 rounded-full pointer-events-none opacity-20"
        style={{ background: 'radial-gradient(circle,#6366f1,transparent 70%)', filter: 'blur(80px)' }}
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 -right-24 w-80 h-80 rounded-full pointer-events-none opacity-15"
        style={{ background: 'radial-gradient(circle,#8b5cf6,transparent 70%)', filter: 'blur(80px)' }}
      />

      <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-20 text-center">
        <Eyebrow className="mb-5">The Future of Sales</Eyebrow>

        <h1
          id="hero-heading"
          className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.1] tracking-tight text-white mb-6"
        >
          Close deals while{' '}
          <br />
          <span className="gradient-text">you sleep.</span>
        </h1>

        <p className="max-w-2xl mx-auto text-lg md:text-xl text-slate-300 leading-relaxed mb-10">
          AI agents qualify every lead, diagnose their problem, and send the perfect
          WhatsApp message — automatically.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
          <CtaButton href={SIGNUP_HREF} size="lg" className="w-full sm:w-auto">
            Start free trial →
          </CtaButton>
          <CtaButton href="#demo" variant="secondary" size="lg" className="w-full sm:w-auto">
            Watch the agents work
          </CtaButton>
        </div>

        <p className="text-sm text-slate-400">
          14-day free trial · No credit card required · Cancel anytime
        </p>
      </div>
    </section>
  );
}
