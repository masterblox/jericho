// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IsabellaGuidedTest } from '../src/sphere/IsabellaGuidedTest'
import { CommandOverlay } from '../src/sphere/CommandOverlay'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('IsabellaGuidedTest', () => {
  it('advances only from bounded evidence and records review without writing Obsidian', async () => {
    const proposal = {
      id: 'obsidian-reorganization-1', version: 1, integrityHash: 'a'.repeat(64),
      summary: 'Reorganize Isabella across family and Masterblox contexts',
      body: { changes: [
        { operation: 'add_context', value: 'family' },
        { operation: 'add_context', value: 'masterblox' },
      ] },
    }
    const actions = {
      openMemory: vi.fn().mockResolvedValue({ relativePath: 'People/Isabella.md' }),
      proposeNoteReorganization: vi.fn().mockResolvedValue({ proposal }),
      decideProposal: vi.fn().mockResolvedValue({ proposal: { ...proposal, status: 'approved' } }),
    }
    render(<IsabellaGuidedTest session={1} actions={actions} />)

    expect(screen.getByText('Say: Who is Isabella?')).toBeTruthy()
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)

    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-tool-result', { detail: {
      name: 'search_vault', result: { available: true, results: [{
        path: 'People/Isabella.md', title: 'Isabella', excerpt: 'Family and Masterblox context.', score: 1,
      }] },
    } })))
    expect(screen.getByText('Family and Masterblox context.')).toBeTruthy()
    expect(screen.getByText('SOURCE · People/Isabella.md')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'OPEN IN OBSIDIAN' }))
    await screen.findByText('Drag Isabella here to preview family and Masterblox organization changes.')
    expect(actions.openMemory).toHaveBeenCalledWith('People/Isabella.md')

    fireEvent.drop(screen.getByText('Drag Isabella here to preview family and Masterblox organization changes.'))
    await screen.findByText('Reorganize Isabella across family and Masterblox contexts')
    expect(actions.proposeNoteReorganization).toHaveBeenCalledWith({
      relativePath: 'People/Isabella.md', title: 'Isabella',
    })
    expect(screen.getByText('EXACT PROPOSAL · NOTHING WRITTEN')).toBeTruthy()

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

  it('ignores unrelated voice tools and reports an empty vault result', () => {
    const actions = { openMemory: vi.fn(), proposeNoteReorganization: vi.fn(), decideProposal: vi.fn() }
    render(<IsabellaGuidedTest session={1} actions={actions} />)
    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-tool-result', {
      detail: { name: 'fleet_status', result: {} },
    })))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-tool-result', {
      detail: { name: 'search_vault', result: { results: [] } },
    })))
    expect(screen.getByRole('alert').textContent).toContain('NO ISABELLA NOTE')
  })

  it('fails closed when vault results contain only unrelated people', () => {
    const actions = { openMemory: vi.fn(), proposeNoteReorganization: vi.fn(), decideProposal: vi.fn() }
    render(<IsabellaGuidedTest session={1} actions={actions} />)

    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-tool-result', { detail: {
      name: 'search_vault', result: { results: [{
        path: 'People/Francisco-Salvaje.md', title: 'Francisco Salvaje',
        excerpt: 'His wife works at another company.', score: 0.99,
      }] },
    } })))

    expect(screen.getByRole('alert').textContent).toContain('NO ISABELLA NOTE')
    expect(screen.queryByText('WIFE')).toBeNull()
    expect(screen.queryByText('MASTERBLOX')).toBeNull()
    expect(screen.queryByText('SOURCE-BACKED')).toBeNull()
    expect(screen.queryByText('Francisco Salvaje')).toBeNull()
  })

  it('does not advance from vault results after the guided test ends', () => {
    const actions = { openMemory: vi.fn(), proposeNoteReorganization: vi.fn(), decideProposal: vi.fn() }
    const view = render(<IsabellaGuidedTest session={1} active actions={actions} />)
    view.rerender(<IsabellaGuidedTest session={1} active={false} actions={actions} />)

    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-tool-result', { detail: {
      name: 'search_vault', result: { results: [{
        path: 'People/Isabella.md', title: 'Isabella', excerpt: 'Late result.', score: 1,
      }] },
    } })))

    expect(screen.getByText('Say: Who is Isabella?')).toBeTruthy()
    expect(screen.queryByText('Late result.')).toBeNull()
  })

  it('preserves evidence and phase when the overlay closes and the same session resumes', async () => {
    const actions = {
      openMemory: vi.fn().mockResolvedValue({ relativePath: 'People/Isabella.md' }),
      proposeNoteReorganization: vi.fn(), decideProposal: vi.fn(), searchMemory: vi.fn(),
      dispatchDirective: vi.fn(), decide: vi.fn(), cancel: vi.fn(),
    }
    const liveData = { missions: [], approvals: [], outcomes: [] }
    const view = render(<CommandOverlay
      open liveData={liveData} actions={actions} guidedTestSession={1} guidedTestActive
      onClose={vi.fn()}
    />)
    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-tool-result', { detail: {
      name: 'search_vault', result: { results: [{
        path: 'People/Isabella.md', title: 'Isabella', excerpt: 'Persisted source evidence.', score: 1,
      }] },
    } })))
    fireEvent.click(screen.getByRole('button', { name: 'OPEN IN OBSIDIAN' }))
    await screen.findByText('Drag Isabella here to preview family and Masterblox organization changes.')

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
    expect(screen.getByText('Drag Isabella here to preview family and Masterblox organization changes.')).toBeTruthy()
    expect(actions.openMemory).toHaveBeenCalledTimes(1)
  })
})
