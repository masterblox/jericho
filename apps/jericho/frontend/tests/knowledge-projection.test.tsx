// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  KnowledgeProjection,
  GROUNDED_RESULT_EVENT,
  INTERFACE_SOUND_EVENT,
  INTERFACE_SOUND_TOGGLE_EVENT,
  INTERFACE_SOUND_MUTED_KEY,
} from '../src/sphere/KnowledgeProjection'

const RESOLVED = {
  resultId: 'grounded-1',
  phase: 'resolved',
  route: 'private_knowledge',
  subject: 'Isabella',
  confidence: 'strong',
  canonicalIdentity: 'Isabella Handel',
  fullName: 'Isabella Handel',
  relationship: 'wife and spouse of Carlos Prada',
  employment: ['MasterBlox'],
  provenance: [
    { relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Family and MasterBlox context.', score: 0.97 },
    { relativePath: 'Sessions/Francisco.md', title: 'Francisco', excerpt: 'Isabella is his wife.', score: 0.42 },
  ],
  actions: {
    open_note: 'People/Isabella Handel.md',
    reorganize_notes: true,
    correct_identity: true,
  },
  retrievalCount: 1,
}

const dispatchResult = (detail: Record<string, unknown>) =>
  act(() => { document.dispatchEvent(new CustomEvent(GROUNDED_RESULT_EVENT, { detail })) })

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

const recordSounds = () => {
  const cues: Array<{ resultId: string; cue: string }> = []
  const listener = (event: Event) => cues.push((event as CustomEvent).detail)
  document.addEventListener(INTERFACE_SOUND_EVENT, listener)
  return { cues, stop: () => document.removeEventListener(INTERFACE_SOUND_EVENT, listener) }
}

const renderProjection = (actions: Record<string, unknown> = {}) =>
  render(<KnowledgeProjection actions={actions} />)

// jsdom has no PointerEvent constructor; synthesize one from MouseEvent so
// clientX/clientY survive and React's onPointer* handlers still receive it.
const firePointer = (target: Element, type: string, init: { pointerId: number; clientX: number; clientY: number }) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId })
  act(() => { target.dispatchEvent(event) })
}

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

describe('KnowledgeProjection materialization', () => {
  it('runs the 0ms/120ms/240ms radial sequence with one sound cue per step', () => {
    vi.useFakeTimers()
    const sounds = recordSounds()
    renderProjection()

    dispatchResult({ resultId: 'grounded-1', phase: 'retrieving', route: 'private_knowledge', subject: 'Isabella', confidence: 'none', provenance: [], actions: {}, retrievalCount: 0 })
    // retrieving: sphere pulse only — no cards yet
    expect(document.querySelector('.knowledge-projection')!.getAttribute('data-phase')).toBe('retrieving')
    expect(document.querySelectorAll('.k-card').length).toBe(0)
    expect(sounds.cues).toEqual([{ resultId: 'grounded-1', cue: 'retrieve' }])

    dispatchResult(RESOLVED)
    // 0ms: primary person card only
    expect(screen.getByText('Isabella Handel')).toBeTruthy()
    expect(document.querySelectorAll('.k-card').length).toBe(1)
    advance(119)
    expect(document.querySelectorAll('.k-card').length).toBe(1)
    advance(1)
    // 120ms: provenance satellite
    expect(document.querySelectorAll('.k-card').length).toBe(2)
    expect(screen.getByText('Sessions/Francisco.md')).toBeTruthy()
    advance(120)
    // 240ms: action plate
    expect(document.querySelectorAll('.k-card').length).toBe(3)
    expect(screen.getByRole('button', { name: 'OPEN NOTE' })).toBeTruthy()

    expect(sounds.cues).toEqual([
      { resultId: 'grounded-1', cue: 'retrieve' },
      { resultId: 'grounded-1', cue: 'summon' },
      { resultId: 'grounded-1', cue: 'satellite' },
      { resultId: 'grounded-1', cue: 'lock' },
    ])

    // a duplicate event must not re-materialize or re-fire cues
    dispatchResult(RESOLVED)
    advance(500)
    expect(sounds.cues.length).toBe(4)

    // Replaying an older result after replacement must not re-emit a cue key.
    dispatchResult({ ...RESOLVED, resultId: 'grounded-2', actions: {}, provenance: [] })
    dispatchResult(RESOLVED)
    expect(sounds.cues.filter(cue => cue.resultId === 'grounded-1' && cue.cue === 'summon')).toHaveLength(1)
    sounds.stop()
  })

  it('never renders a dialog, keeps cards until replaced, and replaces on a new resultId', () => {
    vi.useFakeTimers()
    renderProjection()
    dispatchResult(RESOLVED)
    advance(240)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByText('Isabella Handel').length).toBeGreaterThan(0)

    dispatchResult({
      ...RESOLVED,
      resultId: 'grounded-2',
      canonicalIdentity: 'Francisco Prada',
      fullName: 'Francisco Prada',
      actions: {},
      provenance: [{ relativePath: 'People/Francisco.md', title: 'Francisco Prada', excerpt: 'Canonical note.', score: 0.9 }],
    })
    expect(screen.queryByText('Isabella Handel')).toBeNull()
    expect(screen.getByText('Francisco Prada')).toBeTruthy()
  })

  it('shows spouse evidence, employment, excerpt, every provenance path, and permitted actions for Isabella', () => {
    vi.useFakeTimers()
    renderProjection()
    dispatchResult(RESOLVED)
    advance(240)

    expect(screen.getByText('WIFE AND SPOUSE OF CARLOS PRADA')).toBeTruthy()
    expect(screen.getByText('MASTERBLOX')).toBeTruthy()
    expect(screen.getByText(/RELATION · WIFE AND SPOUSE OF CARLOS PRADA/)).toBeTruthy()
    expect(screen.getByText('Family and MasterBlox context.')).toBeTruthy()
    expect(screen.getByText('People/Isabella Handel.md')).toBeTruthy()
    expect(screen.getByText('Sessions/Francisco.md')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'OPEN NOTE' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'REORGANIZE' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CORRECT' })).toBeTruthy()
  })

  it('renders ambiguous and unavailable cards without fabricating evidence', () => {
    vi.useFakeTimers()
    renderProjection()

    dispatchResult({
      resultId: 'grounded-amb', phase: 'ambiguous', subject: 'Isabella', retrievalCount: 1,
      confidence: 'ambiguous', route: 'private_knowledge',
      provenance: [
        { relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Ambiguous first-name evidence.', score: 0.8 },
        { relativePath: 'Sessions/Francisco.md', title: 'Isabella mention', excerpt: 'Separate mention.', score: 0.4 },
      ],
      actions: {},
    })
    expect(screen.getByText('AMBIGUOUS')).toBeTruthy()
    expect(screen.getByText('Isabella Handel')).toBeTruthy()
    expect(screen.getByText('Isabella mention')).toBeTruthy()

    dispatchResult({ resultId: 'grounded-none', phase: 'unavailable', route: 'private_knowledge', subject: 'Zebulon', confidence: 'none', retrievalCount: 1, reason: 'No canonical note for Zebulon.', provenance: [], actions: {} })
    expect(screen.getByText('UNAVAILABLE')).toBeTruthy()
    expect(screen.getByText('No canonical note for Zebulon.')).toBeTruthy()
  })

  it('adds TEST/LIVE/PASS labels only for guided results', () => {
    vi.useFakeTimers()
    renderProjection()

    dispatchResult(RESOLVED)
    advance(240)
    expect(screen.queryByText('TEST')).toBeNull()
    expect(screen.queryByText('LIVE')).toBeNull()
    expect(screen.queryByText('PASS')).toBeNull()

    dispatchResult({ ...RESOLVED, resultId: 'guided-1', phase: 'ambiguous', confidence: 'ambiguous', guided: { test: 'isabella' } })
    advance(240)
    expect(screen.getAllByText('TEST').length).toBeGreaterThan(0)
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)

    dispatchResult({ ...RESOLVED, resultId: 'guided-2', guided: { test: 'isabella' } })
    advance(240)
    expect(screen.getAllByText('PASS').length).toBeGreaterThan(0)
  })
})

describe('KnowledgeProjection actions', () => {
  it('wires Open Note, Reorganize, and Correct through the authenticated callbacks', async () => {
    const preview = { version: 3, disputedClaim: 'ambiguous first-name binding' }
    const proposal = { id: 'proposal-1', version: 2, integrityHash: 'abc123', summary: 'Group family and employment notes.' }
    const actions = {
      openMemory: vi.fn().mockResolvedValue({}),
      proposeNoteReorganization: vi.fn().mockResolvedValue({ proposal }),
      decideProposal: vi.fn().mockResolvedValue({}),
      correctIdentity: vi.fn().mockResolvedValue(preview),
      confirmCorrection: vi.fn().mockResolvedValue({}),
    }
    vi.useFakeTimers()
    renderProjection(actions)
    dispatchResult(RESOLVED)
    advance(240)
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: 'OPEN NOTE' }))
    await screen.findByText('NOTE OPENED')
    expect(actions.openMemory).toHaveBeenCalledWith('People/Isabella Handel.md')

    fireEvent.click(screen.getByRole('button', { name: 'REORGANIZE' }))
    await screen.findByText('REORGANIZATION PROPOSED')
    expect(actions.proposeNoteReorganization).toHaveBeenCalledWith({
      relativePath: 'People/Isabella Handel.md',
      title: 'Isabella Handel',
    })
    fireEvent.click(screen.getByRole('button', { name: 'APPROVE REORGANIZATION' }))
    await screen.findByText('REORGANIZATION APPROVED')
    expect(actions.decideProposal).toHaveBeenCalledWith({
      proposalId: 'proposal-1',
      proposalHash: 'abc123',
      version: 2,
      outcome: 'approved',
      reason: 'Approved grounded knowledge reorganization preview',
    })

    fireEvent.click(screen.getByRole('button', { name: 'CORRECT' }))
    await screen.findByText('CORRECTION PREVIEW READY')
    expect(actions.correctIdentity).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM CORRECTION' }))
    await screen.findByText('CORRECTION CONFIRMED')
    expect(actions.confirmCorrection).toHaveBeenCalledWith(preview)
  })

  it('keeps cards and actions keyboard accessible', () => {
    vi.useFakeTimers()
    renderProjection({ openMemory: vi.fn() })
    dispatchResult(RESOLVED)
    advance(240)

    const cards = document.querySelectorAll('.k-card')
    expect(cards.length).toBe(3)
    for (const card of cards) expect(card.getAttribute('tabindex')).toBe('0')
    for (const button of screen.getAllByRole('button')) expect(button.tagName).toBe('BUTTON')

    // keyboard parity for edge eject: Delete removes the focused card
    fireEvent.keyDown(document.querySelector('[data-knowledge-card="provenance"]')!, { key: 'Delete' })
    expect(document.querySelector('[data-knowledge-card="provenance"]')).toBeNull()
    expect(document.querySelector('[data-knowledge-card="primary"]')).toBeTruthy()
  })
})

describe('KnowledgeProjection drag and dismissal', () => {
  it('updates card position on pointer drag and persists a non-edge release', () => {
    vi.useFakeTimers()
    renderProjection()
    dispatchResult(RESOLVED)
    advance(240)

    const card = document.querySelector<HTMLElement>('[data-knowledge-card="primary"]')!
    firePointer(card, 'pointerdown', { pointerId: 1, clientX: 400, clientY: 300 })
    firePointer(card, 'pointermove', { pointerId: 1, clientX: 460, clientY: 340 })
    firePointer(card, 'pointerup', { pointerId: 1, clientX: 460, clientY: 340 })

    expect(card.style.getPropertyValue('--dx')).toBe('60px')
    expect(card.style.getPropertyValue('--dy')).toBe('40px')
    expect(document.querySelector('[data-knowledge-card="primary"]')).toBeTruthy()
  })

  it('ejects only the released card when dropped within 48px of a viewport edge', () => {
    vi.useFakeTimers()
    const sounds = recordSounds()
    renderProjection()
    dispatchResult(RESOLVED)
    advance(240)
    sounds.cues.length = 0

    const card = document.querySelector<HTMLElement>('[data-knowledge-card="provenance"]')!
    firePointer(card, 'pointerdown', { pointerId: 2, clientX: 400, clientY: 300 })
    firePointer(card, 'pointermove', { pointerId: 2, clientX: 40, clientY: 300 })
    firePointer(card, 'pointerup', { pointerId: 2, clientX: 40, clientY: 300 })

    expect(document.querySelector('[data-knowledge-card="provenance"]')).toBeNull()
    expect(document.querySelector('[data-knowledge-card="primary"]')).toBeTruthy()
    expect(document.querySelector('[data-knowledge-card="actions"]')).toBeTruthy()
    expect(sounds.cues).toEqual([{ resultId: 'grounded-1', cue: 'dismiss' }])
    sounds.stop()
  })

  it('moves and ejects cards from gesture drag events', () => {
    vi.useFakeTimers()
    renderProjection()
    dispatchResult(RESOLVED)
    advance(240)

    const card = document.querySelector<HTMLElement>('[data-knowledge-card="primary"]')!
    expect(card.getAttribute('data-gesture-draggable')).toBe('true')
    act(() => {
      card.dispatchEvent(new CustomEvent('jericho:drag-move', { detail: { point: { x: 500, y: 300 }, delta: { x: 24, y: -12 } } }))
    })
    expect(card.style.getPropertyValue('--dx')).toBe('24px')
    expect(card.style.getPropertyValue('--dy')).toBe('-12px')

    // cancelled gesture never ejects
    act(() => {
      card.dispatchEvent(new CustomEvent('jericho:drag-end', { detail: { point: { x: 10, y: 300 }, cancelled: true } }))
    })
    expect(document.querySelector('[data-knowledge-card="primary"]')).toBeTruthy()

    act(() => {
      card.dispatchEvent(new CustomEvent('jericho:drag-end', { detail: { point: { x: 10, y: 300 }, cancelled: false } }))
    })
    expect(document.querySelector('[data-knowledge-card="primary"]')).toBeNull()
  })

  it('dismisses the constellation on Escape with a single dismiss cue', () => {
    vi.useFakeTimers()
    const sounds = recordSounds()
    renderProjection()
    dispatchResult(RESOLVED)
    advance(240)
    sounds.cues.length = 0

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelectorAll('.k-card').length).toBe(0)
    expect(sounds.cues).toEqual([{ resultId: 'grounded-1', cue: 'dismiss' }])
    sounds.stop()
  })

  it('dismisses on both-palms cancel-pending only when no approval owns cancellation', () => {
    vi.useFakeTimers()
    renderProjection()
    dispatchResult(RESOLVED)
    advance(240)

    const approval = document.createElement('div')
    approval.setAttribute('data-jericho-active-approval', 'true')
    document.body.appendChild(approval)
    act(() => { document.dispatchEvent(new CustomEvent('jericho:cancel-pending', { detail: { source: 'both-open-palms' } })) })
    expect(document.querySelectorAll('.k-card').length).toBe(3)

    approval.remove()
    act(() => { document.dispatchEvent(new CustomEvent('jericho:cancel-pending', { detail: { source: 'both-open-palms' } })) })
    expect(document.querySelectorAll('.k-card').length).toBe(0)
  })
})

describe('KnowledgeProjection interface sound mute', () => {
  it('persists the toggle, dispatches the toggle event, and silences cues while muted', () => {
    vi.useFakeTimers()
    const sounds = recordSounds()
    const toggles: unknown[] = []
    const onToggle = (event: Event) => toggles.push((event as CustomEvent).detail)
    document.addEventListener(INTERFACE_SOUND_TOGGLE_EVENT, onToggle)
    renderProjection()

    fireEvent.click(screen.getByRole('button', { name: 'Interface sound' }))
    expect(localStorage.getItem(INTERFACE_SOUND_MUTED_KEY)).toBe('true')
    expect(toggles).toEqual([{ muted: true }])
    expect(screen.getByRole('button', { name: 'Interface sound' }).getAttribute('aria-pressed')).toBe('true')

    dispatchResult(RESOLVED)
    advance(240)
    expect(sounds.cues.length).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Interface sound' }))
    expect(localStorage.getItem(INTERFACE_SOUND_MUTED_KEY)).toBe('false')
    dispatchResult({ ...RESOLVED, resultId: 'grounded-3' })
    expect(sounds.cues).toEqual([{ resultId: 'grounded-3', cue: 'summon' }])

    act(() => { document.dispatchEvent(new CustomEvent(INTERFACE_SOUND_TOGGLE_EVENT)) })
    expect(localStorage.getItem(INTERFACE_SOUND_MUTED_KEY)).toBe('true')
    expect(screen.getByRole('button', { name: 'Interface sound' }).getAttribute('aria-pressed')).toBe('true')

    document.removeEventListener(INTERFACE_SOUND_TOGGLE_EVENT, onToggle)
    sounds.stop()
  })

  it('starts muted from the persisted localStorage key', () => {
    localStorage.setItem(INTERFACE_SOUND_MUTED_KEY, 'true')
    const sounds = recordSounds()
    renderProjection()
    expect(screen.getByRole('button', { name: 'Interface sound' }).getAttribute('aria-pressed')).toBe('true')
    dispatchResult(RESOLVED)
    expect(sounds.cues.length).toBe(0)
    sounds.stop()
  })
})

describe('KnowledgeProjection layout contract', () => {
  it('marks reduced motion on the projection root', () => {
    renderProjection()
    expect(document.querySelector('.knowledge-projection')!.getAttribute('data-reduced-motion')).toBe('true')
  })
})
