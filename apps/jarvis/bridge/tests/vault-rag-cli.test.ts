import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, '../../../../ops/vault/vault-rag.py');
const resources: string[] = [];

afterEach(() => {
  for (const path of resources.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('vendored vault-rag CLI', () => {
  it('builds a bounded index and returns structured BM25 search results', () => {
    const root = mkdtempSync(join(tmpdir(), 'jericho-vault-rag-cli-'));
    resources.push(root);
    const vault = join(root, 'brain');
    const index = join(root, 'index.json');
    mkdirSync(vault);
    writeFileSync(join(vault, 'Today.md'), '# Today\nShip Jericho private intelligence operating system.');
    writeFileSync(join(vault, 'Other.md'), '# Other\nUnrelated grocery list.');
    const environment = { ...process.env, VAULT_PATH: vault, VAULT_RAG_INDEX_PATH: index };

    const indexed = JSON.parse(execFileSync('python3', [SCRIPT, 'index', '--json'], {
      encoding: 'utf8', env: environment,
    }));
    expect(indexed).toMatchObject({ documents: 2 });
    expect(indexed.index_size_mb).toBeGreaterThan(0);

    const searched = JSON.parse(execFileSync('python3', [
      SCRIPT, 'search', 'private intelligence', '-n', '1', '--json',
    ], { encoding: 'utf8', env: environment }));
    expect(searched.results).toEqual([expect.objectContaining({
      path: 'Today.md', title: 'Today', excerpt: expect.stringContaining('private intelligence'),
    })]);
    expect(searched.results[0].score).toBeGreaterThan(0);
  });
});
