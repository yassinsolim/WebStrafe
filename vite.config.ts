import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
