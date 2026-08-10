// src/components/legal/LegalPage.jsx — shared chrome for /privacy and /terms.
//
// Carries the draft banner so neither page can be published without it, and
// keeps the prose styling in one place.
import React, { useEffect } from 'react';
import LandingNav from '@components/landing/LandingNav';
import LandingFooter from '@components/landing/LandingFooter';

export default function LegalPage({ title, lastUpdated, children }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — ASOS`;
    return () => { document.title = previous; };
  }, [title]);

  return (
    <>
      <LandingNav />
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">{title}</h1>
        <p className="text-sm text-slate-500 mb-8">Last updated: {lastUpdated}</p>

        <div
          role="note"
          className="mb-10 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
        >
          <strong className="font-semibold">Draft — not legal advice.</strong> This document was
          drafted from how the software actually behaves, not by a lawyer. Have a qualified
          solicitor review it against the law in the jurisdictions you operate in before you
          rely on it or onboard paying clients.
        </div>

        <div className="legal-prose space-y-6 text-slate-300 leading-relaxed">{children}</div>
      </main>
      <LandingFooter />
    </>
  );
}

export function Section({ heading, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-white pt-4">{heading}</h2>
      {children}
    </section>
  );
}
