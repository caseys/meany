import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/** The app's version, from package.json, shown in the corner of the page */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Deployed at https://www.mudberry.com/meany/
  base: '/meany/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['cactus-needle', '@realtimex/piper-tts-web'],
  },
  // WebAssembly threads (Piper, Whistle) need a cross-origin isolated page
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
  },
  preview: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
  },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
