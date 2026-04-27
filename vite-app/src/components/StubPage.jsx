// src/components/StubPage.jsx — Temporary placeholder, replaced as pages are built
import React from 'react';
import { PageHeader } from '@pages/Layout';

export default function StubPage({ title, subtitle = 'Coming up in a later step.' }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="p-8">
        <div className="glass-card flex h-64 items-center justify-center rounded-xl">
          <div className="text-center">
            <div className="mx-auto mb-3 h-10 w-10 rounded-full border-2 border-dashed border-slate-700" />
            <p className="text-sm text-slate-400">{title} page placeholder</p>
            <p className="mt-1 text-xs text-slate-600">Layout preview only — page renders here.</p>
          </div>
        </div>
      </div>
    </>
  );
}
