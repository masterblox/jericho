import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('command-center layout contract', () => {
  it('keeps the desktop operator bays at 26/48/26 without horizontal overflow', () => {
    expect(styles).toMatch(/grid-template-columns:\s*minmax\(0,\s*26fr\)\s+minmax\(0,\s*48fr\)\s+minmax\(0,\s*26fr\)/);
    expect(styles).toContain('overflow-x: hidden');
  });

  it('provides a compact tabbed layout and reuses the local operator-bay plate', () => {
    expect(styles).toContain('@media (max-width: 900px)');
    expect(styles).toContain('/plates/operator-bay.jpg');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
