// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

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
    port: 3001,
  },
});
