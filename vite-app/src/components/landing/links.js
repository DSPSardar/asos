// src/components/landing/links.js — CTA targets and brand constants.
//
// SIGNUP_HREF uses ?tab=register because that is the parameter Auth.jsx
// actually reads (see src/pages/Auth.jsx:37). Any other value silently
// lands the visitor on the Sign In tab.

export const SIGNUP_HREF = '/auth?tab=register';
export const LOGIN_HREF  = '/auth';

export const BRAND_NAME  = import.meta.env.VITE_BRAND_NAME  || 'ASOS';
export const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL || 'info@digitalservicesprogram.com';

export const NAV_LINKS = [
  { href: '#how',      label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#demo',     label: 'See it work' },
  { href: '#pricing',  label: 'Pricing' },
  { href: '#faq',      label: 'FAQ' },
];
