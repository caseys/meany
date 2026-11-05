import { execFileSync } from 'node:child_process';
import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** A git command's output, or null when git or the repository isn't there */
function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The version shown in the corner of the page: major.minor from package.json, the number of
 * commits as the patch, and the commit it was built from, e.g. "0.1.36 · 7c3d833". Without git,
 * just the version in package.json.
 */
function appVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  const count = git('rev-list', '--count', 'HEAD');
  const hash = git('rev-parse', '--short', 'HEAD');
  if (!count || !hash) return version;
  const [major, minor] = version.split('.');
  return `${major}.${minor}.${count} · ${hash}`;
}

/** In dev, restart the server after a commit (or checkout, merge, reset), so the page shows the new version */
function restartOnCommit(): Plugin {
  return {
    name: 'restart-on-commit',
    apply: 'serve',
    configureServer(server) {
      const gitDir = git('rev-parse', '--absolute-git-dir');
      // (only a server with a port: Vitest runs one without, and the watch would keep it from exiting)
      if (!gitDir || !server.httpServer) return;
      // Git appends to this log whenever HEAD moves
      const headLog = join(gitDir, 'logs', 'HEAD');
      const onChange = () => {
        unwatchFile(headLog, onChange);
        void server.restart();
      };
      watchFile(headLog, { interval: 1000 }, onChange);
      server.httpServer.once('close', () => unwatchFile(headLog, onChange));
    },
  };
}

export default defineConfig({
  // Deployed at https://www.mudberry.com/meany/
  base: '/meany/',
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [restartOnCommit()],
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
