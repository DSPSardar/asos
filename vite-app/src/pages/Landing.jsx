// src/pages/Landing.jsx — public marketing landing page.
//
// Composed of focused section components. Sections are ordered as a
// sales argument: promise -> proof -> mechanism -> demonstration ->
// price -> objections -> ask.
import React from 'react';
import LandingNav from '@components/landing/LandingNav';
import Hero from '@components/landing/Hero';
import StatsBar from '@components/landing/StatsBar';

export default function Landing() {
  return (
    <div className="min-h-screen bg-bg text-slate-100 font-sans">
      <LandingNav />
      <main>
        <Hero />
        <StatsBar />
      </main>
    </div>
  );
}
