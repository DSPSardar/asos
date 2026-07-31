// src/components/landing/CtaButton.jsx — the landing page's call-to-action
// button. Defined once so a brand change is a one-file edit.
import React from 'react';

const SIZES = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-3 text-sm',
  lg: 'px-8 py-4 text-base',
};

const BASE =
  'inline-block text-center rounded-xl font-semibold transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2';

const PRIMARY_STYLE = {
  background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
  boxShadow: '0 4px 24px rgba(99,102,241,0.3)',
};

export default function CtaButton({
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
}) {
  const isPrimary = variant === 'primary';
  const variantClasses = isPrimary
    ? 'text-white focus-visible:ring-indigo-300'
    : 'text-slate-200 border border-indigo-500/25 bg-slate-900/60 hover:border-indigo-400/50 hover:text-white focus-visible:ring-indigo-400';

  return (
    <a
      href={href}
      className={`${BASE} ${SIZES[size]} ${variantClasses} ${className}`}
      style={isPrimary ? PRIMARY_STYLE : undefined}
    >
      {children}
    </a>
  );
}
