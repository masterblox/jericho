import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';

import type { ObsidianReceipt } from '@jericho/shared';

export interface CanonicalNoteWriterOptions {
  vaultPath: string;
}

export interface NoteWriteInput {
  relativePath: string;
  expectedHash: string;
  fieldsToAdd: Record<string, string>;
  now: string;
}

export class CanonicalNoteWriter {
  readonly #root: string;

  constructor(options: CanonicalNoteWriterOptions) {
    if (!options.vaultPath.trim()) throw new Error('Vault path is required');
    this.#root = realpathSync(options.vaultPath);
    if (!lstatSync(this.#root).isDirectory()) throw new Error('Vault path is not a directory');
  }

  hashNote(relativePath: string): string {
    const absolute = this.#resolvePath(relativePath);
    if (!existsSync(absolute)) throw new Error(`Note does not exist: ${relativePath}`);
    if (!lstatSync(absolute).isFile()) throw new Error('Note path is not a regular file');
    return createHash('sha256').update(readFileSync(absolute, 'utf8')).digest('hex');
  }

  write(input: NoteWriteInput): ObsidianReceipt {
    const absolute = this.#resolvePath(input.relativePath);
    if (!existsSync(absolute)) throw new Error(`Note does not exist: ${input.relativePath}`);
    const stat = lstatSync(absolute);
    if (!stat.isFile()) throw new Error('Note path is not a regular file');

    const current = readFileSync(absolute, 'utf8');
    const currentHash = createHash('sha256').update(current).digest('hex');
    if (currentHash !== input.expectedHash) {
      throw new Error(`Note hash mismatch: expected ${input.expectedHash.slice(0, 12)}, got ${currentHash.slice(0, 12)}`);
    }

    const fieldsWritten: string[] = [];
    let modified = current;
    for (const [key, value] of Object.entries(input.fieldsToAdd)) {
      const yamlKey = `${key}: `;
      const yamlValue = /^[A-Za-z0-9][A-Za-z0-9 ._@/-]*$/.test(value) ? value : JSON.stringify(value);
      const yamlLine = `${yamlKey}${yamlValue}`;

      const frontmatterEnd = modified.indexOf('\n---', 4);
      if (!modified.startsWith('---\n') || frontmatterEnd === -1) {
        throw new Error('Note has no valid YAML frontmatter');
      }
      const frontmatter = modified.slice(4, frontmatterEnd).split('\n');
      const existingIndex = frontmatter.findIndex((line) => line.startsWith(yamlKey));
      if (existingIndex >= 0 && frontmatter[existingIndex] === yamlLine) continue;

      if (existingIndex >= 0) {
        frontmatter[existingIndex] = yamlLine;
        modified = `---\n${frontmatter.join('\n')}${modified.slice(frontmatterEnd)}`;
        fieldsWritten.push(key);
      } else {
        frontmatter.push(yamlLine);
        modified = `---\n${frontmatter.join('\n')}${modified.slice(frontmatterEnd)}`;
        fieldsWritten.push(key);
      }
    }

    if (!fieldsWritten.length) {
      return { status: 'skipped', notePath: input.relativePath, fieldsWritten: [], completedAt: input.now };
    }

    const dir = dirname(absolute);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.jericho-note-${process.pid}-${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, modified, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temp, absolute);
    } finally {
      rmSync(temp, { force: true });
    }

    return {
      status: 'succeeded',
      notePath: input.relativePath,
      fieldsWritten,
      completedAt: input.now,
    };
  }

  #resolvePath(relativePath: string): string {
    const normalized = relativePath.normalize('NFKD').replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
      throw new Error('Note path must be relative');
    }
    const segments = normalized.split('/');
    for (const segment of segments) {
      if (segment === '..' || segment === '.') throw new Error('Path traversal is not allowed');
    }
    const candidate = resolve(this.#root, normalized);
    const real = realpathSync(candidate, { encoding: 'utf8' });
    if (real !== this.#root && !real.startsWith(`${this.#root}${sep}`)) {
      throw new Error('Note path escapes the vault');
    }
    return candidate;
  }
}
