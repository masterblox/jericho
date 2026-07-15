import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/sphere/styles/scene.css', import.meta.url), 'utf8');

describe('knowledge projection layout contract', () => {
  it('pulses the sphere while retrieving', () => {
    expect(styles).toContain('.stage:has(.knowledge-projection[data-phase="retrieving"])');
  });

  it('uses measured geometry with absolute positioning, not vmin', () => {
    expect(styles).toContain('.k-card {');
    expect(styles).toContain('var(--kw');
    expect(styles).not.toContain('--kx: -36vmin');
  });

  it('fades without spatial ejection under reduced motion', () => {
    expect(styles).toMatch(/\[data-reduced-motion="true"\] \.k-card \{ animation: k-fade/);
    expect(styles).toContain('@keyframes k-fade');
  });

  it('has no backdrop or fixed popup', () => {
    expect(styles).toContain('.knowledge-projection { position: absolute; inset: 0; pointer-events: none;');
    expect(styles).not.toMatch(/\.k-card[^{]*\{[^}]*position: fixed/);
  });

  it('supports left/right/bottom-center/column placement', () => {
    expect(styles).toContain('.k-card--left');
    expect(styles).toContain('.k-card--right');
    expect(styles).toContain('.k-card--bottom-center');
    expect(styles).toContain('.k-card--column');
  });

  it('allows scrollable overflow on narrow screens', () => {
    expect(styles).toContain('overflow-y: auto');
  });
});
