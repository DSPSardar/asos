// src/lib/analytics.js — Google Analytics 4.
//
// Inert unless VITE_GA4_MEASUREMENT_ID is set at build time. With no ID the
// loader never runs, no third-party script is fetched, and every track() call
// is a no-op — so this is safe to merge before the property exists, and safe
// in local development, where you do not want to pollute real funnel data.
//
// GA4 was chosen over PostHog because nothing in this stack uses PostHog
// today; adding it would mean a new vendor and a new data processor to
// declare in the privacy policy. If you would rather have PostHog's session
// replay and product analytics, swap the loader here — the track() call sites
// elsewhere in the app do not need to change.
//
// NOTE ON CONSENT: this fires on load with no consent banner. That is very
// likely not lawful for visitors in the UK/EU under PECR and GDPR. Add a
// consent gate before running ads to those regions.

const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID || '';

export const analyticsEnabled = Boolean(MEASUREMENT_ID);

let loaded = false;

export function initAnalytics() {
  if (!analyticsEnabled || loaded || typeof window === 'undefined') return;
  loaded = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  // gtag must push `arguments` itself — a rest-args wrapper breaks it.
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('js', new Date());
  // send_page_view is left on for the initial load; SPA navigations are
  // reported explicitly by trackPageView below.
  gtag('config', MEASUREMENT_ID);
}

// Fire a GA4 event. Silently does nothing when analytics is disabled, so
// call sites never need to guard.
export function track(eventName, params = {}) {
  if (!analyticsEnabled || typeof window === 'undefined' || !window.gtag) return;
  window.gtag('event', eventName, params);
}

// React Router does not reload the document, so GA4 sees exactly one page
// view for an entire session unless navigations are reported by hand.
export function trackPageView(pathname) {
  if (!analyticsEnabled || typeof window === 'undefined' || !window.gtag) return;
  window.gtag('event', 'page_view', {
    page_path: pathname,
    page_location: window.location.href,
    page_title: document.title,
  });
}

// ── Funnel events ────────────────────────────────────────────────
// Named helpers rather than raw strings at call sites, so the event names
// stay consistent and are all discoverable from one file.

export const trackSignupStarted   = (method = 'email') => track('sign_up_started', { method });
export const trackSignupCompleted = (method = 'email') => track('sign_up', { method });
export const trackLoginCompleted  = (method = 'email') => track('login', { method });
export const trackTrialStarted    = (plan = 'FREE')    => track('trial_started', { plan });
export const trackCtaClicked      = (location)         => track('cta_clicked', { cta_location: location });
