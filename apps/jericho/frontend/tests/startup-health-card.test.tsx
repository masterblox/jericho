// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartupHealthCard } from '../src/sphere/StartupHealthCard'

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true })))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('canonical Sphere startup health card', () => {
  it('shows loading state when healthStatus is loading', () => {
    render(<StartupHealthCard health={undefined} healthStatus="loading" />)
    expect(screen.getByText('LOADING')).toBeTruthy()
    expect(screen.getByText('WAITING FOR HEALTH CHECK')).toBeTruthy()
  })

  it('shows locked state when healthStatus is locked', () => {
    render(<StartupHealthCard health={undefined} healthStatus="locked" />)
    expect(screen.getByText('LOCKED')).toBeTruthy()
    expect(screen.getByText('AUTHENTICATION REQUIRED · CHECK CORE CREDENTIALS')).toBeTruthy()
  })

  it('shows unavailable state when healthStatus is unavailable', () => {
    render(<StartupHealthCard health={undefined} healthStatus="unavailable" />)
    expect(screen.getByText('UNAVAILABLE')).toBeTruthy()
    expect(screen.getByText('CORE HEALTH ENDPOINT UNREACHABLE · NOT OFFLINE')).toBeTruthy()
  })

  it('shows degraded state when healthStatus is degraded without health data', () => {
    render(<StartupHealthCard health={undefined} healthStatus="degraded" />)
    expect(screen.getByText('DEGRADED')).toBeTruthy()
  })

  it('stays out of the way when startup is healthy', () => {
    const view = render(<StartupHealthCard health={{
      ok: true,
      startup: { storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: false },
      vault: { ready: true }, voice: { status: 'available' }, connectors: [],
    }} healthStatus="ready" />)

    expect(view.container.innerHTML).toBe('')
  })

  it('renders durable Core, vault, connector, and archive-not-migrated status', () => {
    render(<StartupHealthCard health={{
      ok: true,
      startup: {
        storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: true,
        recovery: { outcome: 'archived_not_migrated', archive: '~/.jericho/recovery/2026-07-12T00-00-00Z' },
      },
      vault: { ready: true }, voice: { status: 'available' },
      connectors: [{ connectorId: 'obsidian', status: 'healthy' }, { connectorId: 'github', status: 'unavailable' }],
    }} healthStatus="ready" />)
    expect(screen.getByText('RECOVERED')).toBeTruthy()
    expect(screen.getByText('~/.jericho/jericho.db')).toBeTruthy()
    expect(screen.getByText('~/.jericho/recovery/2026-07-12T00-00-00Z')).toBeTruthy()
    expect(screen.getByText('ARCHIVED · NOT MIGRATED')).toBeTruthy()
    expect(screen.getByText('1/2 HEALTHY')).toBeTruthy()
    expect(screen.getAllByText('READY').length).toBeGreaterThan(0)
  })

  it('redacts an unexpected absolute archive path', () => {
    render(<StartupHealthCard health={{
      ok: true,
      startup: { storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: true,
        recovery: { outcome: 'archived_not_migrated', archive: '/Users/carlos/private/recovery' } },
      vault: { ready: false }, voice: { status: 'unavailable' }, connectors: [],
    }} healthStatus="ready" />)
    expect(screen.getByText('REDACTED')).toBeTruthy()
    expect(document.body.textContent).not.toContain('/Users/carlos')
  })
})
