import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

describe('production sphere wiring', () => {
  it('projects authenticated Core truth instead of importing visual fixtures', () => {
    const shell = source('sphere-shell.tsx');
    const projection = source('sphere/components/peripherals.jsx');
    expect(shell).toContain('snapshot?.missions');
    expect(shell).toContain('/api/v1/fleet');
    expect(projection).not.toMatch(/from ['"]\.\.\/data/);
    expect(projection).toContain('data-jericho-active-approval');
  });

  it('exposes the dictated AGENTS / TASKS / BRAIN projections with fail-closed states', () => {
    const projection = source('sphere/components/peripherals.jsx');
    const api = source('sphere/jericho-api.js');
    expect(api).toContain("['CORE', 'AGENTS', 'TASKS', 'BRAIN']");
    expect(projection).toContain('AgentsProjection');
    expect(projection).toContain('TasksProjection');
    expect(projection).toContain('BrainProjection');
    expect(projection).toContain('PAPERCLIP OFFLINE');
    expect(projection).toContain('VAULT SEARCH OFFLINE');
    expect(projection).not.toMatch(/'MISSIONS'|'SIGNALS'|MissionsProjection|SignalsProjection/);
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

  it('serves the sphere as the only product surface, with the Gesture Lab as the hardware harness', () => {
    const entry = source('main.tsx');
    expect(entry).not.toContain("get('view')");
    expect(entry).toContain("get('lab') === 'gestures'");
    expect(entry).toContain("import('./sphere-shell')");
  });

  it('renders the agent halo from live missions only, never a fixture roster', () => {
    const shell = source('sphere-shell.tsx');
    const field = source('sphere/components/ParticleField.jsx');
    const api = source('sphere/jericho-api.js');
    expect(shell).toContain('agents:');
    expect(field).not.toMatch(/from ['"]\.\.\/data/);
    expect(api).not.toMatch(/from ['"]\.\/data/);
    expect(api).toContain('setAgents');
  });
});
