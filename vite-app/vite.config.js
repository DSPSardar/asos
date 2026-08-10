// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'node:fs';
import { ALL_ROUTES } from './src/routes.manifest.js';

// `vite preview` serves production (see vite-app/Dockerfile) and sends
// `Cache-Control: no-cache` on everything, including the content-hashed
// files under /assets/. Those filenames change whenever their contents do,
// so revalidating them is pure waste: every repeat visitor pays a
// conditional round trip per asset to an origin that lives in one region.
//
// It also blocks any CDN placed in front — `no-cache` instructs the edge to
// revalidate against the origin before serving, so a CDN would still hit
// Singapore for each asset. Fix this before adding a CDN, not after.
//
// index.html is deliberately left alone: it must stay `no-cache` so the
// browser always picks up the new hashed filenames after a deploy.
const immutableAssets = () => ({
  name: 'immutable-asset-cache-headers',
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/assets/')) {
        // Setting the header here does not survive: sirv, which backs vite
        // preview, calls res.setHeader('Cache-Control', 'no-cache') of its
        // own accord further down the chain and wins by being last. It ends
        // the response without ever calling writeHead, so patching that hook
        // does not fire either (verified — the header stayed no-cache).
        // Intercepting setHeader is what actually holds.
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => (
          String(name).toLowerCase() === 'cache-control'
            ? setHeader(name, 'public, max-age=31536000, immutable')
            : setHeader(name, value)
        );
      }
      next();
    });
  },
});

// The SPA fallback answers every unmatched URL with index.html at HTTP 200.
// React then renders the 404 page, but the status line still says 200 — a
// soft 404. Google indexes the bad URL and reports it in Search Console.
//
// This returns a real 404 status for any path not in routes.manifest.js while
// still serving the SPA, so React renders <NotFound> for it. Requests with a
// file extension are left alone: they are static assets, and a genuinely
// missing one should 404 from the static handler, not from here.
const notFoundStatus = () => ({
  name: 'spa-404-status',
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const pathname = (req.url || '/').split('?')[0];
      const hasExtension = /\.[a-z0-9]+$/i.test(pathname);
      const known = ALL_ROUTES.includes(pathname === '/' ? '/' : pathname.replace(/\/$/, ''));

      if (!hasExtension && !known) {
        // Same body as any other route — only the status differs.
        const html = readFileSync(path.resolve(__dirname, 'dist/index.html'), 'utf8');
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(html);
        return;
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), immutableAssets(), notFoundStatus()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages':      path.resolve(__dirname, './src/pages'),
      '@lib':        path.resolve(__dirname, './src/lib'),
      '@stores':     path.resolve(__dirname, './src/stores'),
    },
  },

  server: {
    port: 3001,
    proxy: {
      // Proxy API calls to backend in development
      '/api': {
        target:       'http://localhost:3000',
        changeOrigin: true,
        secure:       false,
      },
      '/webhooks': {
        target:       'http://localhost:3000',
        changeOrigin: true,
      },
      // Proxy uploaded files (content images) to backend in development
      '/uploads': {
        target:       'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir:    'dist',
    sourcemap: false,
    minify:    'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor chunks for better caching
          react:    ['react', 'react-dom', 'react-router-dom'],
          charts:   ['recharts'],
          state:    ['zustand'],
        },
      },
    },
    // Warn on chunks > 500kb
    chunkSizeWarningLimit: 500,
  },

  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 3001,
    allowedHosts: [
      'dashboard-production-b65c.up.railway.app',
      'asos-dashboard-production.up.railway.app',
      'dspagenthub.com',
      'www.dspagenthub.com',
    ],
  },
});
