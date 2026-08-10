// src/pages/NotFound.jsx — real 404 page.
//
// Replaces a redirect to "/" that answered every unknown URL with the
// homepage at HTTP 200. That is a soft 404: Google indexes the bad URL,
// reports it under "Soft 404" in Search Console, and visitors who mistype a
// path get silently dumped on the marketing page with no idea they were
// wrong.
//
// The HTTP status itself is set by the preview server (see vite.config.js);
// this component is the body. The noindex tag is belt and braces — it keeps
// the page out of the index even when something is served outside that
// server, such as a local `vite dev` session or a future static host.
import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

export default function NotFound() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, follow';
    document.head.appendChild(meta);

    const previousTitle = document.title;
    document.title = 'Page not found — ASOS';

    return () => {
      document.head.removeChild(meta);
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="min-h-screen bg-bg text-slate-100 flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm tracking-widest text-indigo-400 mb-4">404</p>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4">
          Page not found
        </h1>
        <p className="text-slate-400 mb-2">
          Nothing lives at{' '}
          <code className="font-mono text-slate-300 break-all">{pathname}</code>.
        </p>
        <p className="text-slate-400 mb-8">
          It may have moved, or the link may be wrong.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to="/"
            className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Back to home
          </Link>
          <Link
            to="/auth"
            className="px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-slate-300 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
