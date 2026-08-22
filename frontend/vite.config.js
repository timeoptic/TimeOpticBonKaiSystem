import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * In development the React app is served by Vite on :5173 and every /api call
 * is proxied to the PHP API. Nothing in the app code knows the API's address,
 * so a production build served by Apache alongside api/ just works.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN || 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
