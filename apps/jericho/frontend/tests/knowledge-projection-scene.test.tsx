// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/sphere/components/CoreAssembly', () => ({
  CoreAssembly: () => <div data-testid="reactor" data-gesture-target="core-command" />,
}))
vi.mock('../src/sphere/components/ParticleField', () => ({ ParticleField: () => null }))
vi.mock('../src/sphere/components/peripherals', () => ({
  AgentsProjection: () => null,
  BrainProjection: () => null,
  FleetLifecycle: () => null,
  IdCluster: () => null,
  TasksProjection: () => null,
}))
vi.mock('../src/sphere/StartupHealthCard', () => ({ StartupHealthCard: () => null }))
vi.mock('../src/sphere/VoiceCalibrationCard', () => ({ VoiceCalibrationCard: () => null }))

import Scene from '../src/sphere/Scene'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const renderScene = () => render(<Scene
  coreState="idle"
  mode="CORE"
  selectedAgent={null}
  activeView="CORE"
  setActiveView={() => {}}
  liveData={{ agents: [], fleetStages: [] }}
  health={undefined}
  onVaultSearch={() => {}}
  onOpenCommand={() => {}}
  knowledgeActions={{}}
/>)

describe('Scene knowledge projection', () => {
  it('renders the projection inside layer-near and keeps the reactor through every phase', () => {
    vi.useFakeTimers()
    const view = renderScene()

    const projection = view.container.querySelector('.layer-near .knowledge-projection')
    expect(projection).toBeTruthy()
    expect(screen.getByTestId('reactor')).toBeTruthy()

    act(() => { document.dispatchEvent(new CustomEvent('jericho:grounded-result', { detail: { resultId: 'scene-1', phase: 'retrieving', route: 'private_knowledge', subject: 'Isabella', confidence: 'none', provenance: [], actions: {}, retrievalCount: 0 } })) })
    expect(projection!.getAttribute('data-phase')).toBe('retrieving')
    expect(screen.getByTestId('reactor')).toBeTruthy()

    act(() => { document.dispatchEvent(new CustomEvent('jericho:grounded-result', { detail: {
      resultId: 'scene-1', phase: 'resolved', subject: 'Isabella', route: 'private_knowledge',
      confidence: 'strong', canonicalIdentity: 'Isabella Handel', fullName: 'Isabella Handel',
      relationship: 'wife and spouse of Carlos Prada',
      employment: ['MasterBlox'],
      provenance: [{ relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Family and MasterBlox context.', score: 0.97 }],
      actions: { open_note: 'People/Isabella Handel.md', reorganize_notes: true }, retrievalCount: 1,
    } })) })
    act(() => { vi.advanceTimersByTime(240) })

    expect(view.container.querySelectorAll('.layer-near .k-card').length).toBe(3)
    expect(screen.getByTestId('reactor')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
