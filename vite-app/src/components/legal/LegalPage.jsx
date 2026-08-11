// src/components/legal/LegalPage.jsx — shared chrome for /privacy and /terms.
//
// Keeps the prose styling and page chrome in one place. Carried a draft
// disclaimer banner until solicitor review confirmed the content on
// 11 August 2026 — do not reintroduce a "not legal advice" banner here
// without checking with the business owner first; these are now the real,
// reviewed terms.
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
