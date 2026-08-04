// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/sphere/Scene', () => ({ default: () => <div data-testid="sphere">SPHERE</div> }))
vi.mock('../src/sphere/components', () => ({
  DispatchModal: () => null,
  Toast: () => null,
}))
vi.mock('../src/sphere/jericho-api', () => {
  const snapshot = { directive: null, coreState: 'idle', mode: 'CORE', selectedAgent: null, activeView: 'CORE', toast: '' }
  return {
    store: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    api: { setAgents: vi.fn(), summon: vi.fn(), cancelDispatch: vi.fn(), confirmDispatch: vi.fn(), cycle: vi.fn(), select: vi.fn(), dispatch: vi.fn() },
    installJerichoApi: vi.fn(),
    setDirectiveHandler: vi.fn(),
  }
})
vi.mock('../src/sphere/CommandOverlay', () => ({
  CommandOverlay: ({ open }) => open ? <div data-testid="overlay" role="dialog" /> : null,
}))

import App from '../src/sphere/App'

afterEach(() => cleanup())

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

    // the Scene (reactor included) stays mounted throughout
    expect(screen.getByTestId('sphere')).toBeTruthy()

    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-end', { detail: { test: 'isabella' } })))
    expect(screen.queryByTestId('overlay')).toBeNull()
  })
})
