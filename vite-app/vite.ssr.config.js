// vite.ssr.config.js — build-time only, produces the prerender bundle that
// scripts/prerender.js executes in Node. Never served to a browser.
//
// Separate from vite.config.js on purpose: that config's manualChunks
// splits react/recharts/zustand into vendor chunks for browser caching,
// which is meaningless for a single-entry Node bundle and makes rollup
// emit chunks the prerender script would have to resolve by hand.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  // Kept in sync with vite.config.js by hand. There are only five, and
  // importing that config here would drag in its manualChunks too.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@stores': path.resolve(__dirname, './src/stores'),
    },
  },

  build: {
    ssr: 'src/prerender-entry.jsx',
    outDir: 'dist-ssr',
    minify: false,
    // dist/ is built first and this must not touch it.
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'prerender-entry.js' },
    },
  },
});
