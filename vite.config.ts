import { defineConfig } from 'vite';

export default defineConfig({
  // Deployed at https://www.mudberry.com/meany/
  base: '/meany/',
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
