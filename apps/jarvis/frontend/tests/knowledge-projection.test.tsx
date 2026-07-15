// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeProjection, GROUNDED_RESULT_EVENT, INTERFACE_SOUND_EVENT, INTERFACE_SOUND_TOGGLE_EVENT, INTERFACE_SOUND_MUTED_KEY } from '../src/sphere/KnowledgeProjection'

const V2 = {
  schemaVersion: 2,
  resultId: 'grounded-1',
  phase: 'resolved',
  route: 'private_knowledge',
  summary: 'Isabella Handel is at MasterBlox',
  subject: 'Isabella',
  confidence: 'strong',
  canonicalIdentity: 'Isabella Handel',
  fullName: 'Isabella Handel',
  employment: ['MasterBlox'],
  claims: [
    { id: 'cl-1', text: 'Isabella Handel works at MasterBlox', supportSourceIds: ['src-1'] },
    { id: 'cl-2', text: 'Isabella is wife of Francisco per Sessions note', supportSourceIds: ['src-2'] },
  ],
  conflicts: [
    { id: 'conf-1', claim: 'Francisco-wife claim conflicts with canonical MasterBlox identity', reason: 'No trusted source supports spouse relation', sourceIds: ['src-2'] },
  ],
  provenance: [
    { sourceId: 'src-1', rootId: 'People', authority: 'canonical', relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Family and MasterBlox context.', score: 0.97 },
    { sourceId: 'src-2', rootId: 'Sessions', authority: 'supplemental', relativePath: 'Sessions/Francisco.md', title: 'Francisco', excerpt: 'Isabella mention.', score: 0.42 },
  ],
  actions: { openSourceIds: ['src-1'], reorganizeSourceIds: ['src-1'], correctConflictIds: ['conf-1'] },
  indexRevision: 'r7',
  retrievalCount: 2,
}

const dispatch = (d) => act(() => { document.dispatchEvent(new CustomEvent(GROUNDED_RESULT_EVENT, { detail: d })) })
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms) })
const recordSounds = () => {
  const cues = []
  const l = (e) => cues.push(e.detail)
  document.addEventListener(INTERFACE_SOUND_EVENT, l)
  return { cues, stop: () => document.removeEventListener(INTERFACE_SOUND_EVENT, l) }
}
const renderP = (a = {}) => render(React.createElement(KnowledgeProjection, { actions: a }))

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })))
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('KnowledgeProjection', () => {
  it('renders claims, conflicts, evidence without spouse Carlos relationship', () => {
    vi.useFakeTimers()
    renderP()
    dispatch(V2)
    advance(360)

    expect(screen.getAllByText('Isabella Handel').length).toBeGreaterThan(0)
    expect(screen.getByText('MASTERBLOX')).toBeTruthy()
    expect(screen.getByText('Isabella Handel works at MasterBlox')).toBeTruthy()
    expect(screen.getByText('Isabella is wife of Francisco per Sessions note')).toBeTruthy()
    // Conflict visible
    expect(screen.getByText(/Francisco-wife/)).toBeTruthy()
    // Three cards
    expect(document.querySelectorAll('.k-card').length).toBe(3)
    // No Carlos/spouse promoted as a supported claim
    expect(document.body.textContent).not.toContain('Carlos')
    // The conflict may reference "spouse" in its reason text, which is fine
  })

  it('no dialog, no backdrop', () => {
    vi.useFakeTimers(); renderP(); dispatch(V2); advance(360)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.modal-backdrop')).toBeNull()
  })

  it('calls openMemory with resultId and sourceId', async () => {
    const m = vi.fn().mockResolvedValue({})
    vi.useFakeTimers(); renderP({ openMemory: m }); dispatch(V2); advance(360); vi.useRealTimers()
    fireEvent.click(screen.getByText('OPEN NOTE'))
    await screen.findByText('NOTE OPENED')
    expect(m).toHaveBeenCalledWith('', 'grounded-1', 'src-1')
  })

  it('calls correctIdentity with resultId and conflictId', async () => {
    const m = vi.fn().mockResolvedValue({ version: 1 })
    vi.useFakeTimers(); renderP({ correctIdentity: m, confirmCorrection: vi.fn() }); dispatch(V2); advance(360); vi.useRealTimers()
    fireEvent.click(screen.getByText('CORRECT'))
    await screen.findByText('CORRECTION PREVIEW READY')
    expect(m).toHaveBeenCalledWith('grounded-1', 'conf-1')
  })

  it('dismisses on Escape', () => {
    vi.useFakeTimers(); const s = recordSounds(); renderP(); dispatch(V2); advance(360); s.cues.length = 0
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelectorAll('.k-card').length).toBe(0)
    expect(s.cues).toEqual([{ resultId: 'grounded-1', cue: 'dismiss' }]); s.stop()
  })

  it('mutes', () => {
    vi.useFakeTimers(); renderP()
    fireEvent.click(screen.getByRole('button', { name: 'Interface sound' }))
    expect(localStorage.getItem(INTERFACE_SOUND_MUTED_KEY)).toBe('true')
  })

  it('retrieving has no cards', () => {
    vi.useFakeTimers(); renderP()
    dispatch({ schemaVersion: 2, resultId: 'p', phase: 'retrieving', route: 'private_knowledge', subject: 'X', confidence: 'none', provenance: [], actions: {}, retrievalCount: 0 })
    expect(document.querySelectorAll('.k-card').length).toBe(0)
  })
})
