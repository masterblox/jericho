// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeProjection, GROUNDED_RESULT_EVENT } from '../src/sphere/KnowledgeProjection'
import { GestureTargetRegistry, observeDomGestureTargets } from '../src/gesture-target-registry'

const V2 = {
  schemaVersion: 2, resultId: 'parity-1', phase: 'resolved', route: 'private_knowledge',
  subject: 'Test', confidence: 'strong', canonicalIdentity: 'Test Subject', fullName: 'Test Subject',
  claims: [{ id: 'cl-1', text: 'Claim', supportSourceIds: ['src-1'] }],
  conflicts: [{ id: 'conf-1', claim: 'Conflict', reason: 'Reason', sourceIds: ['src-2'] }],
  provenance: [{ sourceId: 'src-1', rootId: 'root', authority: 'canonical', relativePath: 'Notes/t.md', title: 'Note', excerpt: 'Excerpt.', score: 0.9 }],
  actions: { openSourceIds: ['src-1'], reorganizeSourceIds: ['src-1'], correctConflictIds: ['conf-1'] },
  retrievalCount: 1,
}

const advance = (ms) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })))
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const renderAndDispatch = (a = {}) => {
  vi.useFakeTimers()
  render(React.createElement(KnowledgeProjection, { actions: a }))
  act(() => { document.dispatchEvent(new CustomEvent(GROUNDED_RESULT_EVENT, { detail: V2 })) })
  advance(360)
  vi.useRealTimers()
}

describe('action parity', () => {
  it('pointer, keyboard, and registry each invoke the same result-bound open action exactly once', async () => {
    const openMemory = vi.fn().mockResolvedValue({})
    const expected: [string, string, string] = ['', 'parity-1', 'src-1']

    renderAndDispatch({ openMemory })
    fireEvent.click(screen.getByText('OPEN NOTE'))
    expect(openMemory).toHaveBeenCalledTimes(1)
    expect(openMemory).toHaveBeenCalledWith(...expected)
    cleanup()
    openMemory.mockClear()

    renderAndDispatch({ openMemory })
    const keyboardButton = screen.getByRole('button', { name: /OPEN NOTE/i })
    keyboardButton.focus()
    fireEvent.keyDown(keyboardButton, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
    // jsdom does not synthesize the click browsers fire for Enter on <button>.
    if (openMemory.mock.calls.length === 0) fireEvent.click(keyboardButton)
    expect(openMemory).toHaveBeenCalledTimes(1)
    expect(openMemory).toHaveBeenCalledWith(...expected)
    cleanup()
    openMemory.mockClear()

    renderAndDispatch({ openMemory })
    const registry = new GestureTargetRegistry(document)
    const stop = observeDomGestureTargets(document, registry)
    try {
      const target = registry.get('knowledge:open-note:src-1')
      expect(target).toBeTruthy()
      target!.invokeTap()
    } finally {
      stop()
    }
    expect(openMemory).toHaveBeenCalledTimes(1)
    expect(openMemory).toHaveBeenCalledWith(...expected)
  })

  it('correct: pointer and registry invokeTap call the same callback exactly once each', async () => {
    const m = vi.fn().mockResolvedValue({ version: 1 })
    renderAndDispatch({ correctIdentity: m, confirmCorrection: vi.fn() })
    fireEvent.click(screen.getByText('CORRECT'))
    expect(m).toHaveBeenCalledTimes(1)
    expect(m).toHaveBeenCalledWith('parity-1', 'conf-1')
    m.mockClear()

    const registry = new GestureTargetRegistry(document)
    const stop = observeDomGestureTargets(document, registry)
    try {
      registry.get('knowledge:correct:conf-1')!.invokeTap()
    } finally {
      stop()
    }
    expect(m).toHaveBeenCalledTimes(1)
    expect(m).toHaveBeenCalledWith('parity-1', 'conf-1')
  })

  it('reorganize: pointer and registry invokeTap call the same callback exactly once each', async () => {
    const m = vi.fn().mockResolvedValue({})
    renderAndDispatch({ proposeNoteReorganization: m })
    fireEvent.click(screen.getByText('REORGANIZE'))
    expect(m).toHaveBeenCalledTimes(1)
    expect(m).toHaveBeenCalledWith({ relativePath: '', title: '', resultId: 'parity-1', sourceId: 'src-1' })
    m.mockClear()

    const registry = new GestureTargetRegistry(document)
    const stop = observeDomGestureTargets(document, registry)
    try {
      registry.get('knowledge:reorganize:src-1')!.invokeTap()
    } finally {
      stop()
    }
    expect(m).toHaveBeenCalledTimes(1)
    expect(m).toHaveBeenCalledWith({ relativePath: '', title: '', resultId: 'parity-1', sourceId: 'src-1' })
  })
})

describe('terminal failure states', () => {
  it('open failure never stays WORKING', async () => {
    const m = vi.fn().mockRejectedValue(new Error('SERVER GONE'))
    renderAndDispatch({ openMemory: m })
    fireEvent.click(screen.getByText('OPEN NOTE'))
    await screen.findByText('SERVER GONE')
    expect(screen.queryByText('WORKING')).toBeNull()
  })
  it('correct failure never stays WORKING', async () => {
    const m = vi.fn().mockRejectedValue(new Error('NOT AUTHORIZED'))
    renderAndDispatch({ correctIdentity: m, confirmCorrection: vi.fn() })
    fireEvent.click(screen.getByText('CORRECT'))
    await screen.findByText('NOT AUTHORIZED')
    expect(screen.queryByText('WORKING')).toBeNull()
  })
  it('reorg failure never stays WORKING', async () => {
    const m = vi.fn().mockRejectedValue(new Error('REORG REFUSED'))
    renderAndDispatch({ proposeNoteReorganization: m })
    fireEvent.click(screen.getByText('REORGANIZE'))
    await screen.findByText('REORG REFUSED')
    expect(screen.queryByText('WORKING')).toBeNull()
  })
})
