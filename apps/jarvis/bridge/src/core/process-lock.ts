import { randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CoreProcessLock {
  readonly path: string;
  release(): void;
}

export interface CoreProcessLockOptions {
  root?: string;
  pid?: number;
  token?: string;
  processAlive?: (pid: number) => boolean;
}

interface LockOwner {
  pid: number;
  token: string;
  acquiredAt: string;
}

/**
 * The Core database can coordinate SQLite writes, but two bridge processes
 * would also run duplicate schedulers and connector pollers. An atomic lock
 * directory makes the whole Core runtime single-writer. A crashed owner's
 * lock may be reclaimed only after its PID is confirmed dead.
 */
export function acquireCoreProcessLock(options: CoreProcessLockOptions = {}): CoreProcessLock {
  const root = options.root ?? join(homedir(), '.jericho');
  const pid = options.pid ?? process.pid;
  const token = options.token ?? randomUUID();
  const processAlive = options.processAlive ?? defaultProcessAlive;
  if (!Number.isSafeInteger(pid) || pid <= 0 || !token.trim()) {
    throw new TypeError('Core process lock identity is invalid');
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lockPath = join(root, 'core-writer.lock');
  const ownerPath = join(lockPath, 'owner.json');
  const owner: LockOwner = { pid, token, acquiredAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      writeFileSync(ownerPath, JSON.stringify(owner), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      let released = false;
      return {
        path: lockPath,
        release() {
          if (released) return;
          released = true;
          const current = readOwner(ownerPath);
          if (current?.token === token && current.pid === pid) {
            rmSync(lockPath, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      const stat = safeLstat(lockPath);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('Core process lock path is unsafe');
      }
      const existing = readOwner(ownerPath);
      if (!existing) throw new Error('Core process lock owner is unreadable');
      if (processAlive(existing.pid)) {
        throw new Error(`Jericho Core is already running (pid ${existing.pid})`);
      }
      rmSync(lockPath, { recursive: true, force: false });
    }
  }
  throw new Error('Jericho Core process lock could not be acquired');
}

function readOwner(path: string): LockOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (!Number.isSafeInteger(value.pid) || Number(value.pid) <= 0) return undefined;
    if (typeof value.token !== 'string' || !value.token.trim()) return undefined;
    if (typeof value.acquiredAt !== 'string' || Number.isNaN(Date.parse(value.acquiredAt))) return undefined;
    return { pid: Number(value.pid), token: value.token, acquiredAt: value.acquiredAt };
  } catch {
    return undefined;
  }
}

function safeLstat(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === 'EPERM';
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
