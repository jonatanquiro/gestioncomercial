import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': src('./src'),
      // Los paquetes compartidos se consumen desde el código fuente (ESM).
      '@gc/contracts': src('../../packages/contracts/src/index.ts'),
      '@gc/domain': src('../../packages/domain/src/index.ts'),
    },
  },
  // La web compilada la sirve Laravel desde apps/server/public/spa (sin Node en el servidor).
  base: '/spa/',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
  build: {
    outDir: src('../server/public/spa'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
