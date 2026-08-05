import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';

import {
  bootstrapUrlFromLine,
  browserOpenArguments,
  redactBridgeOutputLine,
} from './dia-launcher.js';

const execFileAsync = promisify(execFile);
const browserApplication = process.env.JERICHO_BROWSER_APP?.trim() || 'Dia';
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) throw new Error('Jericho Dia launcher requires pnpm');

// Fail before Core creates a one-time bootstrap when Dia is unavailable.
try {
  await execFileAsync('/usr/bin/open', ['-Ra', browserApplication]);
} catch {
  console.error(`[jericho] ${browserApplication} is not installed; install it or set JERICHO_BROWSER_APP`);
  process.exit(1);
}

const bridge = spawn(process.execPath, [pnpmCli, 'run', 'start'], {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: ['inherit', 'pipe', 'pipe'],
});

bridge.stderr.pipe(process.stderr);
let browserOpened = false;
const lines = createInterface({ input: bridge.stdout, crlfDelay: Infinity });
lines.on('line', (line) => {
  const bootstrapUrl = bootstrapUrlFromLine(line);
  console.log(redactBridgeOutputLine(line));
  if (!bootstrapUrl || browserOpened) return;
  browserOpened = true;
  void execFileAsync(
    '/usr/bin/open',
    browserOpenArguments(browserApplication, bootstrapUrl),
  ).then(() => {
    console.log(`[jericho] opened private session in ${browserApplication}`);
  }).catch((error: unknown) => {
    console.error(`[jericho] could not open ${browserApplication}; stop and restart Jericho`, error);
  });
});

const forwardSignal = (signal: NodeJS.Signals) => {
  if (bridge.exitCode === null && !bridge.killed) bridge.kill(signal);
};
const onInterrupt = () => forwardSignal('SIGINT');
const onTerminate = () => forwardSignal('SIGTERM');
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);

const [code, signal] = await once(bridge, 'exit') as [number | null, NodeJS.Signals | null];
process.removeListener('SIGINT', onInterrupt);
process.removeListener('SIGTERM', onTerminate);
lines.close();
if (signal) process.kill(process.pid, signal);
else process.exitCode = code ?? 1;
