// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/sphere/components/CoreAssembly', () => ({
  CoreAssembly: () => <div data-testid="reactor" data-gesture-target="core-command" className="core-wrap" />,
}))
vi.mock('../src/sphere/components/ParticleField', () => ({ ParticleField: () => null }))
vi.mock('../src/sphere/components/peripherals', () => ({
  AgentsProjection: () => null, BrainProjection: () => null, FleetLifecycle: () => null, IdCluster: () => null, TasksProjection: () => null,
}))
vi.mock('../src/sphere/StartupHealthCard', () => ({ StartupHealthCard: () => null }))
vi.mock('../src/sphere/VoiceCalibrationCard', () => ({ VoiceCalibrationCard: () => <div data-testid="voice-card">VOICE</div> }))

import Scene from '../src/sphere/Scene'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })))
  localStorage.clear()
})

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const renderScene = (opts: Record<string, unknown> = {}) => render(<Scene
  coreState="idle" mode="CORE" selectedAgent={null}
  activeView={(opts.activeView as string) ?? 'CORE'} setActiveView={() => {}}
  liveData={{ agents: [], fleetStages: [] }} health={undefined}
  onVaultSearch={() => {}} onOpenCommand={() => {}} knowledgeActions={{}}
  guidedTest={opts.guidedTest ?? null}
/>)

describe('Scene knowledge projection', () => {
  it('renders projection and reactor in layer-near', () => {
    vi.useFakeTimers()
    const view = renderScene()
    expect(view.container.querySelector('.layer-near .knowledge-projection')).toBeTruthy()
    expect(screen.getByTestId('reactor')).toBeTruthy()

    act(() => { document.dispatchEvent(new CustomEvent('jericho:grounded-result', { detail: {
      schemaVersion: 2, resultId: 'scene-1', phase: 'resolved', route: 'private_knowledge',
      summary: 'Test', subject: 'Test', confidence: 'strong',
      claims: [], conflicts: [], provenance: [], actions: {}, indexRevision: 0, retrievalCount: 0,
    } })) })
    act(() => { vi.advanceTimersByTime(360) })
    expect(screen.getByTestId('reactor')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows VoiceCalibrationCard only in VOICE mode', () => {
    expect(screen.queryByTestId('voice-card')).toBeNull()
    const view = renderScene({ activeView: 'VOICE' })
    expect(view.getByTestId('voice-card')).toBeTruthy()
  })

  it('marks guided test data attributes', () => {
    const view = renderScene({ guidedTest: { test: 'isabella', active: true, phase: 'verify' } })
    expect(view.container.querySelector('.stage')!.getAttribute('data-guided')).toBe('isabella')
  })
})
