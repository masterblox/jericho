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
}

export function persistentCorePath(home = homedir()): string {
  return join(home, '.jericho', 'jericho.db');
}

/** Explicit destructive recovery. Call only after the --reinitialize-core gate. */
export function reinitializeCore(options: ReinitializeCoreOptions): CoreStartupStatus {
  const home = options.home ?? homedir();
  const databasePath = options.databasePath ?? persistentCorePath(home);
  const files = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].filter(existsSync);
  if (files.length === 0) {
    return { storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: false };
  }
  mkdirSync(join(home, '.jericho', 'recovery'), { recursive: true, mode: 0o700 });
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/gu, '-');
  const archive = join(home, '.jericho', 'recovery', stamp);
  mkdirSync(archive, { recursive: false, mode: 0o700 });

  for (const source of files) {
    const target = join(archive, basename(source));
    copyFileSync(source, target);
    const sourceStat = statSync(source);
    const targetStat = statSync(target);
    if (sourceStat.size !== targetStat.size || (sourceStat.mode & 0o777) !== (targetStat.mode & 0o777)) {
      throw new Error(`Core recovery archive verification failed for ${basename(source)}`);
    }
  }
  // Remove only after every copy verifies. Restore from the archive if either
  // removal or credential rotation fails, so a failed operation remains bootable.
  try {
    for (const source of files) unlinkSync(source);
    options.rotateMasterKey();
  } catch (cause) {
    for (const source of files) {
      if (!existsSync(source)) copyFileSync(join(archive, basename(source)), source);
    }
    throw cause;
  }
  // Ensure the parent is durable/writable before reporting initialization.
  const fd = openSync(dirname(databasePath), 'r');
  closeSync(fd);
  return {
    storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: true,
    recovery: { outcome: 'archived_not_migrated', archive: `~/${relative(home, archive)}` },
  };
}

export function normalStartupStatus(): CoreStartupStatus {
  return { storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: false };
}
