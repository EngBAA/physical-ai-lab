import { defineConfig } from 'vite';
export default defineConfig({
  base: process.env.SITE_BASE || '/',
  server: { host: '0.0.0.0', port: 4175, strictPort: true },
  preview: { host: '0.0.0.0', port: 4175, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
