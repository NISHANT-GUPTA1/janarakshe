import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api -> FastAPI backend so the frontend can call relative
// URLs (no CORS juggling). Backend default port is 8000.
//
// Dev-server hardening (GHSA-67mh-4wv8-2f99): esbuild's dev server accepts
// cross-origin requests, so any site a developer visits while `npm run dev` is
// running could read files from this project through it. The advisory is fixed
// only in Vite 7+, which is a breaking upgrade, so the exposure is closed here
// instead: bind to loopback only and refuse cross-origin dev requests. Production
// builds (`vite build`) are unaffected by the advisory either way.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    cors: false,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    // Never ship source maps: they republish the readable source and comments.
    sourcemap: false,
  },
});
