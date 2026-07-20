import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export default defineConfig(({ mode }) => {
  const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
  const environment = { ...loadEnv(mode, runtimeRoot, ''), ...process.env };
  const corePort = environment.CONDUCTOR_PORT ?? environment.PORT ?? '8787';
  const core = `http://127.0.0.1:${corePort}`;
  const token = environment.JERICHO_API_TOKEN?.trim();
  const authenticatedProxy = token
    ? { headers: { authorization: `Bearer ${token}` } }
    : {};
  const commit = environment.GITHUB_SHA ?? readGitCommit();
  return {
    define: { __JERICHO_COMMIT__: JSON.stringify(commit) },
    plugins: [react()],
    publicDir: fileURLToPath(new URL('./public', import.meta.url)),
    server: {
      port: 5173,
      proxy: {
        '/api': { target: core, ...authenticatedProxy },
        '/ws': { target: core.replace('http:', 'ws:'), ws: true, ...authenticatedProxy },
      },
    },
    build: { target: 'es2022', outDir: 'dist' },
  };
});

function readGitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '0000000';
  }
}
