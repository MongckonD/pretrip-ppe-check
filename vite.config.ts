import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev server only: every /admin/... tab path loads the admin page (the Worker does this in production). */
const adminPages: Plugin = {
  name: 'admin-pages',
  configureServer(server) {
    server.middlewares.use((req: { url?: string }, _res: unknown, next: () => void) => {
      const path = (req.url ?? '').split('?')[0];
      if (/^\/admin(\/[^.]*)?$/.test(path)) req.url = '/admin/index.html';
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), adminPages],
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
