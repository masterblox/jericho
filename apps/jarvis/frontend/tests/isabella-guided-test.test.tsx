// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IsabellaGuidedTest } from '../src/sphere/IsabellaGuidedTest'
import { CommandOverlay } from '../src/sphere/CommandOverlay'
import { VoiceCalibrationCard } from '../src/sphere/VoiceCalibrationCard'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('IsabellaGuidedTest', () => {
  it('advances only from identity-aware evidence and records review without writing Obsidian', async () => {
    const proposal = {
      id: 'obsidian-reorganization-1', version: 1, integrityHash: 'a'.repeat(64),
      summary: 'Reorganize Isabella Handel across family and Masterblox contexts',
      body: { changes: [
        { operation: 'add_context', value: 'family' },
        { operation: 'add_context', value: 'masterblox' },
      ] },
    }
    const actions = {
      openMemory: vi.fn().mockResolvedValue({ relativePath: 'People/Isabella Handel.md' }),
      proposeNoteReorganization: vi.fn().mockResolvedValue({ proposal }),
      decideProposal: vi.fn().mockResolvedValue({ proposal: { ...proposal, status: 'approved' } }),
    }
    render(<IsabellaGuidedTest session={1} actions={actions} />)

    expect(screen.getByText('Say: Who is Isabella?')).toBeTruthy()

    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-phase', { detail: {
      test: 'isabella',
      phase: 'presenting',
      evidence: {
        query: 'Isabella',
        retrievalCount: 1,
        groups: [],
        excluded: [{
          fullName: 'Isabella (ambiguous)',
          canonical: false,
          ambiguous: true,
          provenance: [{ relativePath: 'Sessions/Francisco.md', title: 'Francisco', excerpt: 'Isabella is his wife.', score: 0.5 }],
        }],
        resolved: {
          fullName: 'Isabella Handel',
          canonical: true,
          ambiguous: false,
          relationshipToCarlos: 'wife / spouse of Carlos Prada',
          employment: ['MasterBlox'],
          provenance: [{
            relativePath: 'People/Isabella Handel.md',
            title: 'Isabella Handel',
            excerpt: 'Family and MasterBlox context.',
            score: 1,
          }],
        },
      },
    } })))
    expect(screen.getByText('Family and MasterBlox context.')).toBeTruthy()
    expect(screen.getByText('SOURCE · People/Isabella Handel.md')).toBeTruthy()
    expect(screen.getByText(/Ambiguous first-name evidence/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'OPEN IN OBSIDIAN' }))
    await screen.findByText('Drag Isabella Handel here to preview family and MasterBlox organization changes.')
    expect(actions.openMemory).toHaveBeenCalledWith('People/Isabella Handel.md')

    fireEvent.drop(screen.getByText('Drag Isabella Handel here to preview family and MasterBlox organization changes.'))
    await screen.findByText('Reorganize Isabella Handel across family and Masterblox contexts')
    expect(actions.proposeNoteReorganization).toHaveBeenCalledWith({
      relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel',
    })

    fireEvent.click(screen.getByRole('button', { name: 'APPROVE PREVIEW' }))
    await screen.findByText('CORE RECORDED · APPROVED · OBSIDIAN UNCHANGED')
    expect(actions.decideProposal).toHaveBeenCalledWith({
      proposalId: proposal.id,
      proposalHash: proposal.integrityHash,
      version: proposal.version,
      outcome: 'approved',
      reason: 'Approved Isabella guided-test preview',
    })
  })

  it('does not advance from vault results after the guided test ends', () => {
    const actions = { openMemory: vi.fn(), proposeNoteReorganization: vi.fn(), decideProposal: vi.fn() }
    const view = render(<IsabellaGuidedTest session={1} active actions={actions} />)
    view.rerender(<IsabellaGuidedTest session={1} active={false} actions={actions} />)

    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-phase', { detail: {
      test: 'isabella',
      phase: 'presenting',
      evidence: {
        query: 'Isabella', retrievalCount: 1, groups: [], excluded: [],
        resolved: {
          fullName: 'Isabella Handel', canonical: true, ambiguous: false,
          provenance: [{ relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Late result.', score: 1 }],
        },
      },
    } })))

    expect(screen.getByText('Say: Who is Isabella?')).toBeTruthy()
    expect(screen.queryByText('Late result.')).toBeNull()
  })

  it('preserves evidence and phase when the overlay closes and the same session resumes', async () => {
    const actions = {
      openMemory: vi.fn().mockResolvedValue({ relativePath: 'People/Isabella Handel.md' }),
      proposeNoteReorganization: vi.fn(), decideProposal: vi.fn(), searchMemory: vi.fn(),
      dispatchDirective: vi.fn(), decide: vi.fn(), cancel: vi.fn(),
    }
    const liveData = { missions: [], approvals: [], outcomes: [] }
    const view = render(<CommandOverlay
      open liveData={liveData} actions={actions} guidedTestSession={1} guidedTestActive
      onClose={vi.fn()}
    />)
    act(() => document.dispatchEvent(new CustomEvent('jericho:guided-test-phase', { detail: {
      test: 'isabella',
      phase: 'presenting',
      evidence: {
        query: 'Isabella', retrievalCount: 1, groups: [], excluded: [],
        resolved: {
          fullName: 'Isabella Handel', canonical: true, ambiguous: false,
          provenance: [{ relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Persisted source evidence.', score: 1 }],
        },
      },
    } })))
    fireEvent.click(screen.getByRole('button', { name: 'OPEN IN OBSIDIAN' }))
    await screen.findByText('Drag Isabella Handel here to preview family and MasterBlox organization changes.')

    view.rerender(<CommandOverlay
      open={false} liveData={liveData} actions={actions} guidedTestSession={1} guidedTestActive
      onClose={vi.fn()}
    />)
    expect(screen.getByRole('dialog', { hidden: true }).hidden).toBe(true)

    view.rerender(<CommandOverlay
      open liveData={liveData} actions={actions} guidedTestSession={1} guidedTestActive
      onClose={vi.fn()}
    />)
    expect(screen.getByText('Persisted source evidence.')).toBeTruthy()
    expect(screen.getByText('Drag Isabella Handel here to preview family and MasterBlox organization changes.')).toBeTruthy()
    expect(actions.openMemory).toHaveBeenCalledTimes(1)
  })
})

describe('VoiceCalibrationCard', () => {
  it('auditions a voice and confirms a local preset', () => {
    const preview = vi.fn()
    const confirm = vi.fn()
    document.addEventListener('jericho:preview-voice', preview)
    document.addEventListener('jericho:confirm-voice', confirm)
    render(<VoiceCalibrationCard />)

    act(() => document.dispatchEvent(new CustomEvent('jericho:voices', {
      detail: {
        voices: ['Algieba', 'Orus'],
        active: 'Algieba',
        auditionSentence: 'Hello, sir. Jericho systems are online and at your disposal.',
      },
    })))

    fireEvent.click(screen.getByRole('option', { name: 'Orus' }))
    expect(preview).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM VOICE' }))
    expect(confirm).toHaveBeenCalled()

    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-confirmed', {
      detail: { voice: 'Orus', confirmedAt: '2026-07-12T12:00:00.000Z' },
    })))
    expect(JSON.parse(localStorage.getItem('jericho.voice.preset.v1')!).voice).toBe('Orus')
    document.removeEventListener('jericho:preview-voice', preview)
    document.removeEventListener('jericho:confirm-voice', confirm)
  })
})
