import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
};

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
