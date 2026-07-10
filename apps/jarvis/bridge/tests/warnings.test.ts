import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('bridge test warning policy', () => {
  it('suppresses the known node:sqlite experimental warning', () => {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', "await import('node:sqlite')"],
      {
        encoding: 'utf8',
        env: process.env,
      },
    );

    expect(child.status).toBe(0);
    expect(child.stderr).not.toContain(
      'SQLite is an experimental feature and might change at any time',
    );
  });

  it('keeps unrelated experimental warnings visible', () => {
    const child = spawnSync(
      process.execPath,
      [
        '--eval',
        "process.emitWarning('unrelated experimental warning', { type: 'ExperimentalWarning', code: 'JERICHO_TEST_WARNING' })",
      ],
      {
        encoding: 'utf8',
        env: process.env,
      },
    );

    expect(child.status).toBe(0);
    expect(child.stderr).toContain('[JERICHO_TEST_WARNING] ExperimentalWarning');
    expect(child.stderr).toContain('unrelated experimental warning');
  });
});
