import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Three HTML entry points: the drop-in demo (index.html) plus the two dev-only
// tooling pages used to build the model (data collection + training).
export default defineConfig({
  server: { port: 5200 },
  build: {
    rollupOptions: {
      input: {
        demo: resolve(__dirname, 'index.html'),
        collect: resolve(__dirname, 'tools/collect.html'),
        train: resolve(__dirname, 'tools/train.html'),
      },
    },
  },
});
