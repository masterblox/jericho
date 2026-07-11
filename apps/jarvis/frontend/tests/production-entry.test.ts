import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url);
const entry = readFileSync(new URL('src/main.tsx', root), 'utf8');
const html = readFileSync(new URL('index.html', root), 'utf8');

describe('production React entry', () => {
  it('mounts the command center and explicit engage gate without the fixture HUD', () => {
    expect(html).toContain('/src/main.tsx');
    expect(entry).toContain('createRoot');
    expect(entry).toContain('CommandCenterApp');
    expect(entry).toContain('EngageGate');
    expect(entry).toContain("get('lab') === 'gestures'");
    expect(entry).toContain('GestureLab');
    expect(entry).not.toMatch(/HUD|SAMPLE_TASKS|NAV_COMMANDS/);
    expect(existsSync(new URL('src/main.ts', root))).toBe(false);
    expect(existsSync(new URL('src/hud.ts', root))).toBe(false);
  });
});
