import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConnectorHealthStatus } from '@jericho/shared';

import { loadConfig } from '../src/config.js';
import { JerichoStore } from '../src/core/store.js';
import { createConnectorRuntime } from '../src/runtime.js';

const KEY = Buffer.alloc(32, 83);
const resources: Array<() => void> = [];

afterEach(() => {
  for (const dispose of resources.splice(0).reverse()) dispose();
});

describe('connector runtime composition', () => {
  it('boots connector-only, registers deterministic descriptors, and runs configured local sources', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'jericho-runtime-vault-'));
    resources.push(() => rmSync(vault, { recursive: true, force: true }));
    writeFileSync(join(vault, 'Today.md'), '# Today\nShip Jericho.');
    const store = new JerichoStore({ path: ':memory:', key: KEY });
    resources.push(() => store.close());
    const config = loadConfig({
      JERICHO_API_TOKEN: 'runtime-token',
      JERICHO_OBSIDIAN_VAULT: vault,
    }, []);

    const runtime = createConnectorRuntime(config, store, { workerId: 'runtime-test' });

    expect(runtime.descriptors.map((item) => item.id)).toEqual([
      'linear',
      'obsidian',
      'telegram',
    ]);
    await expect(runtime.supervisor.sync('telegram', 'primary')).resolves.toMatchObject({
      status: 'unavailable',
    });
    expect(store.listConnectorHealth()).toContainEqual(expect.objectContaining({
      connectorId: 'telegram',
      status: ConnectorHealthStatus.Unavailable,
    }));
    await expect(runtime.supervisor.sync('obsidian', 'vault')).resolves.toMatchObject({
      status: 'completed', captures: 1,
    });
    expect(await runtime.obsidianSearch?.search('ship', 5)).toContainEqual(expect.objectContaining({
      path: 'Today.md',
    }));
    expect(store.listEvents({ limit: 10 })).toContainEqual(expect.objectContaining({
      type: 'obsidian.note.snapshot',
    }));
  });
});
