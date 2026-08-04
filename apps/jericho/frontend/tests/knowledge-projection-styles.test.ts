import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/sphere/styles/scene.css', import.meta.url), 'utf8');

describe('knowledge projection layout contract', () => {
  it('pulses the sphere alone while retrieving', () => {
    expect(styles).toContain('.stage:has(.knowledge-projection[data-phase="retrieving"])');
  });

  it('stacks cards below the still-visible sphere on narrow screens', () => {
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.k-card \{ position: static/);
  });

  it('uses fade/scale without spatial ejection under reduced motion', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?k-fade/);
    expect(styles).toContain('@keyframes k-fade');
  });

  it('keeps the constellation stroke-and-light with no backdrop or fixed popup', () => {
    expect(styles).toContain('.knowledge-projection { position: absolute; inset: 0; pointer-events: none; }');
    expect(styles).not.toMatch(/\.k-card[^{]*\{[^}]*position: fixed/);
  });
});
