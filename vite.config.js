import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        top50: resolve(import.meta.dirname, 'top50.html'),
      },
    },
  },
});
