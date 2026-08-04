import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObsidianNoteOpener } from '../src/connectors/obsidian-open.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Obsidian note opener', () => {
  it('opens an existing relative Markdown note with an encoded Obsidian URL', async () => {
    const vault = temporaryDirectory();
    mkdirSync(join(vault, 'Projects'));
    writeFileSync(join(vault, 'Projects', 'Fleet plan.md'), '# Fleet');
    const launch = vi.fn().mockResolvedValue(undefined);
    const opener = new ObsidianNoteOpener({ vaultPath: vault, launch });

    await expect(opener.open('Projects/Fleet plan.md')).resolves.toEqual({ relativePath: 'Projects/Fleet plan.md' });
    expect(launch).toHaveBeenCalledTimes(1);
    const url = new URL(launch.mock.calls[0][0]);
    expect(url.protocol).toBe('obsidian:');
    expect(url.searchParams.get('vault')).toBe(vault.split('/').at(-1));
    expect(url.searchParams.get('file')).toBe('Projects/Fleet plan');
  });

  it('rejects traversal, absolute paths, non-Markdown files, and symlinks', async () => {
    const vault = temporaryDirectory();
    const outside = temporaryDirectory();
    writeFileSync(join(vault, 'note.txt'), 'no');
    writeFileSync(join(outside, 'secret.md'), 'secret');
    symlinkSync(join(outside, 'secret.md'), join(vault, 'linked.md'));
    const opener = new ObsidianNoteOpener({ vaultPath: vault, launch: vi.fn() });

    await expect(opener.open('../secret.md')).rejects.toThrow(/invalid/i);
    await expect(opener.open('/tmp/secret.md')).rejects.toThrow(/invalid/i);
    await expect(opener.open('note.txt')).rejects.toThrow(/invalid/i);
    await expect(opener.open('linked.md')).rejects.toThrow(/regular file/i);
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'jericho-obsidian-open-'));
  directories.push(directory);
  return directory;
}
