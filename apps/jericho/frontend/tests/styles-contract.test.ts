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

  it('keeps local calibration and sanitized diagnostics usable above the React bays', () => {
    expect(styles).toContain('.jericho-runtime-controls');
    expect(styles).toContain('.jericho-runtime-controls button:focus-visible');
    expect(styles).toContain('.jericho-runtime-calibration');
    expect(styles).toContain('.jericho-runtime-diagnostics');
  });

  it('keeps Efferd tokens and Geist on the chat shell without dropping operator-bay fallback', () => {
    expect(styles).toContain('--background: oklch(0.145 0 0)');
    expect(styles).toContain('--foreground: oklch(0.985 0 0)');
    expect(styles).toContain('--muted: oklch(0.269 0 0)');
    expect(styles).toContain('--muted-foreground: oklch(0.708 0 0)');
    expect(styles).toContain('--border: oklch(0.269 0 0)');
    expect(styles).toContain('--primary: oklch(0.922 0 0)');
    expect(styles).toContain('--radius: 0.625rem');
    expect(styles).toContain('--background: oklch(1 0 0)');
    expect(styles).toContain('"Geist Variable"');
    expect(styles).toContain('.cn-card');
    expect(styles).toContain('.jericho-sidebar');
    expect(styles).toContain('.jericho-usage-meter');
  });
});
