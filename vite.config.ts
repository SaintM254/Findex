import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app', '.localhost'], port: 5173 },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 650 },
});
