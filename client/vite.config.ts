import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api and the socket to the game server so the client uses
// one origin (keeps getUserMedia happy) and CORS stays simple.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
