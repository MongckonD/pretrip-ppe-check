import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // polling: the native file watcher sometimes misses edits on Windows, leaving the page stale
  server: { port: 5173, host: true, watch: { usePolling: true, interval: 300 } },
});
