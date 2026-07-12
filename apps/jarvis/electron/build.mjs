import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
};

mkdirSync('electron/dist', { recursive: true });
execFileSync('/usr/bin/clang', [
  '-fobjc-arc', '-framework', 'Foundation', '-framework', 'Security',
  'electron/keychain-helper.m', '-o', 'electron/dist/jericho-keychain-helper',
], { stdio: 'inherit' });
chmodSync('electron/dist/jericho-keychain-helper', 0o755);

await Promise.all([
  build({
    ...shared,
    entryPoints: ['electron/main.ts'],
    outfile: 'electron/dist/main.cjs',
    format: 'cjs',
  }),
  build({
    ...shared,
    entryPoints: ['electron/preload.ts'],
    outfile: 'electron/dist/preload.cjs',
    format: 'cjs',
  }),
]);
