// src/components/landing/LandingFooter.jsx — footer nav and trust badges.
import React from 'react';
import LogoMark from './LogoMark';
import { LOGIN_HREF, NAV_LINKS, SALES_EMAIL, SIGNUP_HREF } from './links';

export default function LandingFooter() {
  return (
    <footer className="border-t border-indigo-500/10">
      <div className="max-w-6xl mx-auto px-6 py-14">
        <div className="flex flex-col md:flex-row md:items-start gap-10 md:gap-6">
          <div className="md:flex-1">
            <div className="mb-3">
              <LogoMark />
            </div>
            <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
              The AI Sales Operating System. Close deals while you sleep.
            </p>
          </div>

          <nav aria-label="Footer" className="md:flex-1">
            <FooterHeading>Product</FooterHeading>
            <ul className="space-y-2.5">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-slate-400 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="md:flex-1">
            <FooterHeading>Get started</FooterHeading>
            <ul className="space-y-2.5">
              <li>
                <a href={SIGNUP_HREF} className="text-sm text-slate-400 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
                  Start free trial
                </a>
              </li>
              <li>
                <a href={LOGIN_HREF} className="text-sm text-slate-400 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
                  Sign in
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${SALES_EMAIL}?subject=ASOS%20Demo%20Request`}
                  className="text-sm text-slate-400 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                >
                  Contact sales
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} dspagenthub.com · All rights reserved
          </p>
          <div className="flex items-center gap-6 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true">🔒</span> End-to-end encrypted
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true">⚡</span> 99.9% uptime
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// Footer column heading. Deliberately not <Eyebrow>: these are real <h2>
// landmarks in a lighter shade, not the indigo section label.
function FooterHeading({ children }) {
  return (
    <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-widest font-mono mb-4">
      {children}
    </h2>
  );
}
