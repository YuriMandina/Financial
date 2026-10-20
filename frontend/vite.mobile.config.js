// Build do app de contagem (Android via Capacitor). Separado do sistema web: gera só o módulo de contagem.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = fileURLToPath(new URL('.', import.meta.url));
const version = JSON.parse(readFileSync(new URL('./mobile-version.json', import.meta.url), 'utf-8'));

export default defineConfig({
  root: 'mobile',
  base: './',
  plugins: [react()],
  css: { postcss: here },
  define: {
    __APP_VERSION__: JSON.stringify(version.versionName),
    __APP_VERSION_CODE__: JSON.stringify(version.versionCode),
  },
  build: {
    outDir: '../dist-mobile',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    fs: { allow: ['..'] },
  },
});
