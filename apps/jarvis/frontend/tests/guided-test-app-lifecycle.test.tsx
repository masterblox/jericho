// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/sphere/Scene', () => ({ default: () => <div>SPHERE</div> }))
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
  CommandOverlay: ({ open, guidedTestSession, guidedTestActive }) => open
    ? <div data-testid="overlay" data-session={guidedTestSession} data-active={String(guidedTestActive)} />
    : null,
}))

import App from '../src/sphere/App'

afterEach(() => cleanup())

describe('Sphere guided-test lifecycle', () => {
  it('starts, ends, and resumes the canonical overlay from runtime events', () => {
    render(<App liveData={{ agents: [], missions: [], approvals: [], outcomes: [] }} commandActions={{}} />)

    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-start', { detail: { test: 'isabella' } })))
    expect(screen.getByTestId('overlay').getAttribute('data-session')).toBe('1')
    expect(screen.getByTestId('overlay').getAttribute('data-active')).toBe('true')

    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-end', { detail: { test: 'isabella' } })))
    expect(screen.queryByTestId('overlay')).toBeNull()

    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-resume', { detail: { test: 'isabella' } })))
    expect(screen.getByTestId('overlay').getAttribute('data-session')).toBe('1')
    expect(screen.getByTestId('overlay').getAttribute('data-active')).toBe('true')
  })
})
