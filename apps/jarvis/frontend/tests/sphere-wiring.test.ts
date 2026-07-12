import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

describe('production sphere wiring', () => {
  it('projects authenticated Core truth instead of importing visual fixtures', () => {
    const shell = source('sphere-shell.tsx');
    const projection = source('sphere/components/peripherals.jsx');
    expect(shell).toContain('snapshot.missions');
    expect(shell).toContain('snapshot.history');
    expect(projection).not.toMatch(/from ['"]\.\.\/data/);
    expect(projection).toContain('data-jericho-active-approval');
  });

  it('preserves production gesture and exact-plan action boundaries', () => {
    const shell = source('sphere-shell.tsx');
    const scene = source('sphere/Scene.jsx');
    expect(scene).toContain('data-jericho-nucleus-space="true"');
    expect(scene).toContain('jericho:nucleus-camera');
    expect(scene).toContain('jericho:nucleus-depth');
    expect(shell).toContain('client.decideMission');
    expect(shell).toContain('client.cancelMission');
  });

  it('projects the five-stage fleet lifecycle and maps real lifecycle enum values', () => {
    const shell = source('sphere-shell.tsx');
    const peripherals = source('sphere/components/peripherals.jsx');
    expect(shell).toContain("label: 'LEARN'");
    expect(shell).toContain('LifecycleStatus.Active');
    expect(shell).toContain('LifecycleStatus.Succeeded');
    expect(shell).not.toMatch(/status === ['"]executing['"]/);
    expect(peripherals).toContain('Fleet delivery lifecycle');
    expect(peripherals).toContain('key={signal.id');
  });

  it('retains the command center and Gesture Lab as explicit fallback surfaces', () => {
    const entry = source('main.tsx');
    expect(entry).toContain("get('view') === 'command'");
    expect(entry).toContain("get('lab') === 'gestures'");
    expect(entry).toContain("import('./sphere-shell')");
  });
});
