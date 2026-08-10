// src/prerender-entry.jsx — build-time only. Never shipped to the browser.
//
// Renders the above-the-fold shell (nav + hero) to static HTML so the
// <h1> — which is the LCP element, this page has no images — paints as
// soon as the HTML and CSS arrive, instead of waiting for ~90KB of JS to
// download, parse, and boot React.
//
// Scope is deliberately just these two components. Both, and everything
// they import (CtaButton, Eyebrow, LogoMark), are pure and hook-free, so
// there is no SSR hazard here. Sections further down the page DO use
// hooks and browser APIs — AgentPipeline reads window.matchMedia — and
// they are below the fold, so they contribute nothing to LCP. Do not
// widen this to the full <Landing> tree to "prerender more"; it buys no
// LCP and imports real SSR risk.
//
// The client still renders the whole tree normally. scripts/prerender.js
// injects this output as a paint-only placeholder that React replaces on
// boot, so this is not hydration and there is no markup contract to keep
// in sync — the components below are the single source of truth.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingNav from '@components/landing/LandingNav';
import Hero from '@components/landing/Hero';

export function render() {
  return renderToStaticMarkup(
    <>
      <LandingNav />
      <main>
        <Hero />
      </main>
    </>
  );
}
