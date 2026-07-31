// src/components/landing/Eyebrow.jsx — small mono uppercase section label.
// Mirrors the treatment used on the auth page (src/pages/Auth.jsx:362).
import React from 'react';

export default function Eyebrow({ as: Tag = 'p', className = '', children }) {
  return (
    <Tag
      className={`text-xs font-semibold text-indigo-400 uppercase tracking-widest font-mono ${className}`}
    >
      {children}
    </Tag>
  );
}
