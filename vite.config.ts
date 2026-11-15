import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
