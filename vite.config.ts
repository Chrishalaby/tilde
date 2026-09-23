import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: false },
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4173', changeOrigin: true } },
  },
});
