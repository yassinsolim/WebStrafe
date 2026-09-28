import { defineConfig } from 'vitest/config';

// ports are overridable so several checkouts can run dev servers side by side
const serverPort = Number(process.env.WEBSTRAFE_SERVER_PORT ?? 8787);
const vitePort = process.env.WEBSTRAFE_VITE_PORT ? Number(process.env.WEBSTRAFE_VITE_PORT) : undefined;

// capture and qa hooks (?shot=, ?qa=1) ship in vercel preview builds, never in production
if (process.env.VERCEL_ENV === 'preview' && process.env.VITE_DEV_TOOLS === undefined) {
  process.env.VITE_DEV_TOOLS = 'true';
}

export default defineConfig({
  server: {
    port: vitePort,
    strictPort: vitePort !== undefined,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://127.0.0.1:${serverPort}`,
        ws: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'tools/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
