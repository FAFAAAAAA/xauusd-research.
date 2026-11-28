import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'web/index.html'),
        watch: resolve(import.meta.dirname, 'web/watch.html'),
      },
    },
  },
  test: {
    root: import.meta.dirname,
    include: ['tests/unit/**/*.test.ts'],
  },
});
