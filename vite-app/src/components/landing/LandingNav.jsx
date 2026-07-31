// src/components/landing/LandingNav.jsx — sticky top navigation.
import React from 'react';
import CtaButton from './CtaButton';
import LogoMark from './LogoMark';
import { LOGIN_HREF, NAV_LINKS, SIGNUP_HREF } from './links';

export default function LandingNav() {
  return (
    <header
      className="sticky top-0 z-50 border-b border-indigo-500/10 backdrop-blur-xl"
      style={{ background: 'rgba(3,7,18,0.88)' }}
    >
      <nav
        aria-label="Main"
        className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-6"
      >
        <a href="/" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
          <LogoMark glow />
        </a>

        <ul className="hidden md:flex items-center gap-1 ml-auto">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 ml-auto md:ml-0">
          <a
            href={LOGIN_HREF}
            className="hidden sm:block px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Sign in
          </a>
          <CtaButton href={SIGNUP_HREF} size="sm" className="whitespace-nowrap">
            Start free trial
          </CtaButton>
        </div>
      </nav>
    </header>
  );
}
