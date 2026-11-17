import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // two web pages: staff (/) and admin (/admin/), one shared code base and one API
  build: {
    rollupOptions: {
      input: { main: 'index.html', admin: 'admin/index.html' },
    },
  },
  // polling: the native file watcher sometimes misses edits on Windows, leaving the page stale
  // /api goes to the local Worker (npm run dev:api) when running `npm run dev:cf`
  server: {
    port: 5173, host: true, watch: { usePolling: true, interval: 300 },
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
