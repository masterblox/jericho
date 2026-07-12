import { execFile } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ObsidianOpenOptions {
  vaultPath: string;
  launch?: (url: string) => Promise<void>;
}

/** Opens one existing Markdown note without exposing or accepting absolute paths. */
export class ObsidianNoteOpener {
  readonly #root: string;
  readonly #launch: (url: string) => Promise<void>;

  constructor(options: ObsidianOpenOptions) {
    this.#root = realpathSync(options.vaultPath);
    if (!lstatSync(this.#root).isDirectory()) throw new Error('Obsidian vault path is unavailable');
    this.#launch = options.launch ?? (async (url) => {
      await execFileAsync('/usr/bin/open', [url], { timeout: 10_000, maxBuffer: 16 * 1024 });
    });
  }

  async open(relativePath: string): Promise<{ relativePath: string }> {
    const normalized = validatedRelativePath(relativePath);
    const candidate = join(this.#root, ...normalized.split('/'));
    assertInside(this.#root, candidate);
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Obsidian note is not a regular file');
    const resolved = realpathSync(candidate);
    assertInside(this.#root, resolved);
    const canonicalRelative = relative(this.#root, resolved).split(sep).join('/');
    if (canonicalRelative !== normalized) throw new Error('Obsidian note path changed during resolution');
    const url = new URL('obsidian://open');
    url.searchParams.set('vault', basename(this.#root));
    url.searchParams.set('file', canonicalRelative.replace(/\.md$/iu, ''));
    await this.#launch(url.toString());
    return { relativePath: canonicalRelative };
  }
}

function validatedRelativePath(value: string): string {
  const path = value.trim().replace(/\\/gu, '/');
  if (!path || path.length > 1_024 || path.startsWith('/') || extname(path).toLocaleLowerCase() !== '.md') {
    throw new Error('Obsidian note path is invalid');
  }
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Obsidian note path is invalid');
  }
  return segments.join('/');
}

function assertInside(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Obsidian note is outside the vault');
  }
}
