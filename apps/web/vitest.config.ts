import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Separado de vite.config.ts: Vitest 3 trae sus propios tipos de Vite 7.
export default defineConfig({
  resolve: {
    alias: {
      '@': src('./src'),
      '@gc/contracts': src('../../packages/contracts/src/index.ts'),
      '@gc/domain': src('../../packages/domain/src/index.ts'),
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
