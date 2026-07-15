// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/sphere/Scene', () => ({ default: ({ guidedTest }) => <div data-testid="sphere" data-guided={guidedTest?.test ?? 'none'} data-phase={guidedTest?.phase ?? 'none'}>SPHERE</div> }))
vi.mock('../src/sphere/components', () => ({
  DispatchModal: () => null,
  Toast: () => null,
}))
vi.mock('../src/sphere/jericho-api', () => {
  const snapshot = { directive: null, coreState: 'idle', mode: 'CORE', selectedAgent: null, activeView: 'CORE', toast: '', guidedTest: null }
  return {
    store: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    api: {
      setAgents: vi.fn(), summon: vi.fn(), cancelDispatch: vi.fn(), confirmDispatch: vi.fn(), cycle: vi.fn(), select: vi.fn(), dispatch: vi.fn(),
      startGuidedTest: vi.fn(), resumeGuidedTest: vi.fn(), updateGuidedPhase: vi.fn(), endGuidedTest: vi.fn(),
    },
    installJerichoApi: vi.fn(),
    setDirectiveHandler: vi.fn(),
  }
})
vi.mock('../src/sphere/CommandOverlay', () => ({
  CommandOverlay: ({ open }) => open ? <div data-testid="overlay" role="dialog" /> : null,
}))

import App from '../src/sphere/App'
import { api } from '../src/sphere/jericho-api'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Sphere grounded-knowledge lifecycle', () => {
  it('never opens the command overlay for guided or natural knowledge events', () => {
    render(<App liveData={{ agents: [], missions: [], approvals: [], outcomes: [] }} commandActions={{}} />)

    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-start', { detail: { test: 'isabella' } })))
    expect(screen.queryByTestId('overlay')).toBeNull()

    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-resume', { detail: { test: 'isabella' } })))
    expect(screen.queryByTestId('overlay')).toBeNull()

    act(() => document.dispatchEvent(new CustomEvent('jericho:grounded-result', { detail: {
      resultId: 'grounded-1', phase: 'resolved', route: 'private_knowledge', subject: 'Isabella', confidence: 'strong',
      canonicalIdentity: 'Isabella Handel', fullName: 'Isabella Handel', provenance: [], actions: {}, retrievalCount: 1,
    } })))
    expect(screen.queryByTestId('overlay')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    expect(screen.getByTestId('sphere')).toBeTruthy()

    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-end', { detail: { test: 'isabella' } })))
    expect(screen.queryByTestId('overlay')).toBeNull()
  })

  it('calls api.startGuidedTest on guided-test-start', () => {
    render(<App liveData={{ agents: [], missions: [], approvals: [], outcomes: [] }} commandActions={{}} />)
    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-start', { detail: { test: 'isabella' } })))
    expect(api.startGuidedTest).toHaveBeenCalledWith('isabella')
  })

  it('calls api.resumeGuidedTest on guided-test-resume', () => {
    render(<App liveData={{ agents: [], missions: [], approvals: [], outcomes: [] }} commandActions={{}} />)
    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-resume', { detail: { test: 'isabella' } })))
    expect(api.resumeGuidedTest).toHaveBeenCalledWith('isabella')
  })

  it('calls api.updateGuidedPhase on guided-test-phase', () => {
    render(<App liveData={{ agents: [], missions: [], approvals: [], outcomes: [] }} commandActions={{}} />)
    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-phase', { detail: { phase: 'verify' } })))
    expect(api.updateGuidedPhase).toHaveBeenCalledWith('verify')
  })

  it('calls api.endGuidedTest on guided-test-end', () => {
    render(<App liveData={{ agents: [], missions: [], approvals: [], outcomes: [] }} commandActions={{}} />)
    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-end', { detail: { test: 'isabella' } })))
    expect(api.endGuidedTest).toHaveBeenCalled()
  })

  it('closes the command overlay when guided test starts', () => {
    render(<App liveData={{ agents: [], missions: [], approvals: [], outcomes: [] }} commandActions={{}} />)
    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-start', { detail: { test: 'isabella' } })))
    expect(screen.queryByTestId('overlay')).toBeNull()
  })
})
