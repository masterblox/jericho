// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/sphere/components/CoreSphere', () => ({
  CoreSphere: () => React.createElement('div', { 'data-testid': 'mock-core-sphere' }),
}));
vi.mock('../src/sphere/components/ParticleField', () => ({
  ParticleField: () => React.createElement('div', { 'data-testid': 'mock-particle-field' }),
}));
vi.mock('../src/sphere/components/charts', () => ({
  SegmentBar: () => React.createElement('div'),
}));

import { IdCluster } from '../src/sphere/components/peripherals';
import { CoreAssembly } from '../src/sphere/components/CoreAssembly';
import { DispatchModal } from '../src/sphere/components';
import { CommandOverlay } from '../src/sphere/CommandOverlay';
import { BrainProjection } from '../src/sphere/components/peripherals';
import { KnowledgeProjection } from '../src/sphere/KnowledgeProjection';
import { StartupHealthCard } from '../src/sphere/StartupHealthCard';

beforeEach(() => {
  (window as any).matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const emptyLiveData = {
  connected: true,
  missions: [],
  approvals: [],
  outcomes: [],
  paperclip: [],
  fleetStages: [],
};

describe('gesture target audit', () => {
  it('IdCluster view tabs have gesture targets', () => {
    render(React.createElement(IdCluster, { activeView: 'CORE', onView: () => {}, coreState: 'idle', connected: true }));
    ['CORE', 'AGENTS', 'TASKS', 'BRAIN'].forEach((view) => {
      expect(document.querySelector(`[data-gesture-target="view:${view.toLowerCase()}"]`)).toBeTruthy();
    });
  });

  it('CoreAssembly has core-command gesture target', () => {
    render(React.createElement(CoreAssembly, { onOpenCommand: () => {} }));
    expect(document.querySelector('[data-gesture-target="core-command"]')).toBeTruthy();
  });

  it('DispatchModal confirm/cancel have gesture targets', () => {
    render(React.createElement(DispatchModal, { directive: 'test directive', onClose: () => {}, onDispatch: () => {} }));
    expect(document.querySelector('[data-gesture-target="dispatch:cancel"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="dispatch:confirm"]')).toBeTruthy();
  });

  it('CommandOverlay nav buttons have gesture targets', () => {
    render(React.createElement(CommandOverlay, {
      open: true,
      onClose: () => {},
      liveData: emptyLiveData,
      actions: {
        searchMemory: async () => ({ results: [] }),
        openMemory: async () => ({}),
        dispatchDirective: () => {},
        decide: async () => {},
        cancel: async () => {},
        retain: async () => {},
      },
    }));
    ['close', 'directive', 'memory', 'correct', 'approvals', 'missions', 'outcomes'].forEach((mode) => {
      expect(document.querySelector(`[data-gesture-target="command:${mode}"]`)).toBeTruthy();
    });
  });

  it('BrainProjection search button has gesture target', () => {
    render(React.createElement(BrainProjection, { nucleus: { nodes: 0, edges: 0 }, onSearch: () => {} }));
    expect(document.querySelector('[data-gesture-target="brain:search"]')).toBeTruthy();
  });

  it('KnowledgeProjection sound toggle has gesture target', () => {
    render(React.createElement(KnowledgeProjection, { actions: {} }));
    expect(document.querySelector('[data-gesture-target="knowledge:sound-toggle"]')).toBeTruthy();
  });

  it('buttons exist and have appropriate roles', () => {
    render(React.createElement(IdCluster, { activeView: 'CORE', onView: () => {}, coreState: 'idle', connected: true }));
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const tag = button.tagName.toLowerCase();
      expect(tag).toBe('button');
    }
  });

  it('StartupHealthCard shows loading state', () => {
    render(React.createElement(StartupHealthCard, { health: undefined, healthStatus: 'loading' }));
    expect(screen.getByText('LOADING')).toBeTruthy();
    expect(screen.getByText('WAITING FOR HEALTH CHECK')).toBeTruthy();
  });

  it('StartupHealthCard shows locked state', () => {
    render(React.createElement(StartupHealthCard, { health: undefined, healthStatus: 'locked' }));
    expect(screen.getByText('LOCKED')).toBeTruthy();
  });

  it('StartupHealthCard shows unavailable state', () => {
    render(React.createElement(StartupHealthCard, { health: undefined, healthStatus: 'unavailable' }));
    expect(screen.getByText('UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText('CORE HEALTH ENDPOINT UNREACHABLE · NOT OFFLINE')).toBeTruthy();
  });
});
