import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * El index.html compilado se commitea: sale siempre con LF, aunque se compile en Windows con
 * el fuente en CRLF (si no, el chequeo de "archivos generados al día" falla en CI).
 */
const lfIndexHtml: Plugin = {
  name: 'index-html-lf',
  enforce: 'post',
  transformIndexHtml: (html) => html.replace(/\r/g, ''),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), lfIndexHtml],
  resolve: {
    alias: {
      '@': src('./src'),
      // Los paquetes compartidos se consumen desde el código fuente (ESM).
      '@gc/contracts': src('../../packages/contracts/src/index.ts'),
      '@gc/domain': src('../../packages/domain/src/index.ts'),
    },
  },
  // La web compilada la sirve Laravel desde apps/server/public/spa (sin Node en el servidor).
  // Rutas relativas: Laravel agrega el prefijo del sitio al entregar el HTML.
  base: './',
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
