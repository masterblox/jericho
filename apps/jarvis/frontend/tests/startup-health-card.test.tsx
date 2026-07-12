// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartupHealthCard } from '../src/sphere/StartupHealthCard'

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true })))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('canonical Sphere startup health card', () => {
  it('renders durable Core, vault, connector, and archive-not-migrated status', () => {
    render(<StartupHealthCard health={{
      ok: true,
      startup: {
        storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: true,
        recovery: { outcome: 'archived_not_migrated', archive: '~/.jericho/recovery/2026-07-12T00-00-00Z' },
      },
      vault: { ready: true }, voice: { status: 'available' },
      connectors: [{ connectorId: 'obsidian', status: 'healthy' }, { connectorId: 'github', status: 'unavailable' }],
    }} />)
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
    }} />)
    expect(screen.getByText('REDACTED')).toBeTruthy()
    expect(document.body.textContent).not.toContain('/Users/carlos')
  })
})
