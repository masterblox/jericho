import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

export interface CoreStartupStatus {
  storage: 'persistent';
  database: '~/.jericho/jericho.db';
  initializedNewCore: boolean;
  recovery?: { outcome: 'archived_not_migrated'; archive: string };
}

export interface ReinitializeCoreOptions {
  databasePath?: string;
  home?: string;
  now?: Date;
  rotateMasterKey: () => void;
  fs?: RecoveryFileSystem;
}

export interface RecoveryFileSystem {
  exists(path: string): boolean;
  mkdir(path: string, options: { recursive: boolean; mode: number }): void;
  copy(source: string, target: string): void;
  stat(path: string): { size: number; mode: number };
  unlink(path: string): void;
  open(path: string): number;
  close(fd: number): void;
}

const nodeFileSystem: RecoveryFileSystem = {
  exists: existsSync,
  mkdir: (path, options) => mkdirSync(path, options),
  copy: copyFileSync,
  stat: statSync,
  unlink: unlinkSync,
  open: (path) => openSync(path, 'r'),
  close: closeSync,
};

export function persistentCorePath(home = homedir()): string {
  return join(home, '.jericho', 'jericho.db');
}

/** Explicit destructive recovery. Call only after the --reinitialize-core gate. */
export function reinitializeCore(options: ReinitializeCoreOptions): CoreStartupStatus {
  const home = options.home ?? homedir();
  const fs = options.fs ?? nodeFileSystem;
  const databasePath = options.databasePath ?? persistentCorePath(home);
  const files = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].filter(fs.exists);
  if (files.length === 0) {
    return { storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: false };
  }
  fs.mkdir(join(home, '.jericho', 'recovery'), { recursive: true, mode: 0o700 });
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/gu, '-');
  const archive = join(home, '.jericho', 'recovery', stamp);
  fs.mkdir(archive, { recursive: false, mode: 0o700 });
  const directoryFd = fs.open(dirname(databasePath));
  fs.close(directoryFd);

  for (const source of files) {
    const target = join(archive, basename(source));
    fs.copy(source, target);
    const sourceStat = fs.stat(source);
    const targetStat = fs.stat(target);
    if (sourceStat.size !== targetStat.size || (sourceStat.mode & 0o777) !== (targetStat.mode & 0o777)) {
      throw new Error(`Core recovery archive verification failed for ${basename(source)}`);
    }
  }
  // Remove only after every copy verifies. Restore from the archive if either
  // removal or credential rotation fails, so a failed operation remains bootable.
  try {
    for (const source of files) fs.unlink(source);
    options.rotateMasterKey();
  } catch (cause) {
    for (const source of files) {
      if (!fs.exists(source)) fs.copy(join(archive, basename(source)), source);
    }
    throw cause;
  }
  return {
    storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: true,
    recovery: { outcome: 'archived_not_migrated', archive: `~/${relative(home, archive)}` },
  };
}

export function normalStartupStatus(): CoreStartupStatus {
  return { storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: false };
}
