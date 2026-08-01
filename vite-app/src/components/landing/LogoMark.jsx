// src/components/landing/LogoMark.jsx — gradient logo square, optionally
// followed by the brand name.
import React from 'react';
import { BRAND_NAME } from './links';

export default function LogoMark({ withName = true, glow = false }) {
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold ${glow ? 'glow-accent' : ''}`}
        style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
      >
        A
      </span>
      {withName && (
        <span className="text-base font-bold text-white tracking-tight">{BRAND_NAME}</span>
      )}
    </span>
  );
}
