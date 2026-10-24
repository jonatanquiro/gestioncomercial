import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@gc/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@gc/domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
    },
  },
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    setupFiles: ['./src/test/env.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
