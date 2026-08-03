import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const filterUrl = new URL('./filter-sqlite-warning.mjs', import.meta.url).href;
const nodeOptions = [process.env.NODE_OPTIONS, `--import=${filterUrl}`]
  .filter(Boolean)
  .join(' ');

if (process.argv[2] === '--print-node-options') {
  process.stdout.write(`${nodeOptions}\n`);
  process.exit(0);
}

const vitest = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [vitest, 'run', ...process.argv.slice(2)],
  {
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
