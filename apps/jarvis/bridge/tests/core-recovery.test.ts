import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { reinitializeCore, type RecoveryFileSystem } from '../src/core/recovery.js';

function fileSystem(overrides: Partial<RecoveryFileSystem> = {}): RecoveryFileSystem {
  return {
    exists: existsSync, mkdir: (path, options) => { mkdirSync(path, options); },
    copy: copyFileSync, stat: statSync, unlink: unlinkSync,
    open: (path) => openSync(path, 'r'), close: closeSync, ...overrides,
  };
}

describe('explicit Core recovery', () => {
  it('archives the database, WAL, and SHM with permissions before preparing a new Core', () => {
    const home = mkdtempSync(join(tmpdir(), 'jericho-recovery-'));
    const root = join(home, '.jericho');
    mkdirSync(root, { recursive: true });
    const db = join(root, 'jericho.db');
    writeFileSync(db, 'database', { mode: 0o600 });
    writeFileSync(`${db}-wal`, 'wal', { mode: 0o640 });
    writeFileSync(`${db}-shm`, 'shm', { mode: 0o600 });
    const rotateMasterKey = vi.fn();

    const status = reinitializeCore({
      home, databasePath: db, rotateMasterKey,
      now: new Date('2026-07-12T10:11:12.345Z'),
    });

    expect(status).toEqual({
      storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: true,
      recovery: { outcome: 'archived_not_migrated', archive: '~/.jericho/recovery/2026-07-12T10-11-12-345Z' },
    });
    expect(rotateMasterKey).toHaveBeenCalledOnce();
    for (const [name, content, mode] of [
      ['jericho.db', 'database', 0o600], ['jericho.db-wal', 'wal', 0o640], ['jericho.db-shm', 'shm', 0o600],
    ] as const) {
      const archived = join(home, status.recovery!.archive.slice(2), name);
      expect(readFileSync(archived, 'utf8')).toBe(content);
      expect(statSync(archived).mode & 0o777).toBe(mode);
    }
    expect(existsSync(db)).toBe(false);
    expect(existsSync(`${db}-wal`)).toBe(false);
    expect(existsSync(`${db}-shm`)).toBe(false);
    expect(reinitializeCore({ home, databasePath: db, rotateMasterKey }))
      .toMatchObject({ initializedNewCore: false });
    expect(rotateMasterKey).toHaveBeenCalledOnce();
  });

  it('is a no-op when already clean and never rotates a credential twice', () => {
    const home = mkdtempSync(join(tmpdir(), 'jericho-recovery-clean-'));
    const rotateMasterKey = vi.fn();
    expect(reinitializeCore({ home, rotateMasterKey })).toMatchObject({ initializedNewCore: false });
    expect(rotateMasterKey).not.toHaveBeenCalled();
  });

  it('leaves originals in place if credential rotation fails', () => {
    const home = mkdtempSync(join(tmpdir(), 'jericho-recovery-fail-'));
    const db = join(home, '.jericho', 'jericho.db');
    mkdirSync(join(home, '.jericho'), { recursive: true });
    writeFileSync(db, 'database', { mode: 0o600 });
    expect(() => reinitializeCore({
      home, databasePath: db, now: new Date('2026-07-12T00:00:00Z'),
      rotateMasterKey: () => { throw new Error('keychain locked'); },
    })).toThrow('keychain locked');
    expect(readFileSync(db, 'utf8')).toBe('database');
  });

  it('does not rotate or remove originals after a partial archive-copy failure', () => {
    const home = mkdtempSync(join(tmpdir(), 'jericho-recovery-copy-fail-'));
    const db = join(home, '.jericho', 'jericho.db');
    mkdirSync(join(home, '.jericho'), { recursive: true });
    writeFileSync(db, 'database'); writeFileSync(`${db}-wal`, 'wal');
    const rotateMasterKey = vi.fn();
    let copies = 0;
    expect(() => reinitializeCore({ home, databasePath: db, rotateMasterKey,
      now: new Date('2026-07-12T02:00:00Z'), fs: fileSystem({ copy: (source, target) => {
        copies += 1; if (copies === 2) throw new Error('disk full'); copyFileSync(source, target);
      } }),
    })).toThrow('disk full');
    expect(rotateMasterKey).not.toHaveBeenCalled();
    expect(readFileSync(db, 'utf8')).toBe('database');
    expect(readFileSync(`${db}-wal`, 'utf8')).toBe('wal');
  });

  it('restores already-unlinked files if a later unlink fails', () => {
    const home = mkdtempSync(join(tmpdir(), 'jericho-recovery-unlink-fail-'));
    const db = join(home, '.jericho', 'jericho.db');
    mkdirSync(join(home, '.jericho'), { recursive: true });
    writeFileSync(db, 'database'); writeFileSync(`${db}-wal`, 'wal');
    let unlinks = 0;
    expect(() => reinitializeCore({ home, databasePath: db, rotateMasterKey: vi.fn(),
      now: new Date('2026-07-12T03:00:00Z'), fs: fileSystem({ unlink: (path) => {
        unlinks += 1; if (unlinks === 2) throw new Error('unlink failed'); unlinkSync(path);
      } }),
    })).toThrow('unlink failed');
    expect(readFileSync(db, 'utf8')).toBe('database');
    expect(readFileSync(`${db}-wal`, 'utf8')).toBe('wal');
  });

  it('fails closed on a timestamp collision without touching the Core', () => {
    const home = mkdtempSync(join(tmpdir(), 'jericho-recovery-collision-'));
    const db = join(home, '.jericho', 'jericho.db');
    const archive = join(home, '.jericho', 'recovery', '2026-07-12T04-00-00-000Z');
    mkdirSync(archive, { recursive: true }); writeFileSync(db, 'database');
    const rotateMasterKey = vi.fn();
    expect(() => reinitializeCore({ home, databasePath: db, rotateMasterKey,
      now: new Date('2026-07-12T04:00:00Z'),
    })).toThrow();
    expect(readFileSync(db, 'utf8')).toBe('database');
    expect(rotateMasterKey).not.toHaveBeenCalled();
  });
});
