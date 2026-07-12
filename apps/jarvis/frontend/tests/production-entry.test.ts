import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url);
const entry = readFileSync(new URL('src/main.tsx', root), 'utf8');
const html = readFileSync(new URL('index.html', root), 'utf8');

describe('production React entry', () => {
  it('mounts the sphere and explicit engage gate without fixtures or legacy surfaces', () => {
    expect(html).toContain('/src/main.tsx');
    expect(entry).toContain('createRoot');
    expect(entry).toContain('SphereShell');
    expect(entry).toContain('EngageGate');
    expect(entry).toContain("get('lab') === 'gestures'");
    expect(entry).toContain('GestureLab');
    expect(entry).not.toMatch(/HUD|SAMPLE_TASKS|NAV_COMMANDS|CommandCenterApp|view=command/);
    expect(existsSync(new URL('src/main.ts', root))).toBe(false);
    expect(existsSync(new URL('src/hud.ts', root))).toBe(false);
    expect(existsSync(new URL('src/command-center-app.tsx', root))).toBe(false);
    expect(existsSync(new URL('src/sphere/data.js', root))).toBe(false);
  });
});
