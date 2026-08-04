// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OperatorActivity } from '../src/sphere/OperatorActivity'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('OperatorActivity', () => {
  it('shows bounded local action progress and its verified receipt summary', () => {
    vi.useFakeTimers()
    render(<OperatorActivity />)

    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-tool-start', {
      detail: { name: 'arrange_window' },
    })))
    expect(screen.getByRole('status').textContent).toContain('Arranging window…')
    expect(screen.getByRole('status').getAttribute('data-state')).toBe('running')

    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-tool-result', {
      detail: {
        name: 'arrange_window',
        result: { available: true, status: 'succeeded', summary: 'Moved Safari to left on display 1.' },
      },
    })))
    expect(screen.getByRole('status').textContent).toContain('Moved Safari to left on display 1.')
    expect(screen.getByRole('status').getAttribute('data-state')).toBe('succeeded')

    act(() => vi.advanceTimersByTime(7000))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('translates permission failures without exposing raw local errors', () => {
    render(<OperatorActivity />)
    act(() => document.dispatchEvent(new CustomEvent('jericho:voice-tool-result', {
      detail: {
        name: 'computer_status',
        result: { available: false, status: 'failed', error: 'accessibility_permission_required' },
      },
    })))

    expect(screen.getByRole('status').textContent).toContain('Privacy & Security → Accessibility')
    expect(screen.getByRole('status').getAttribute('data-state')).toBe('failed')
  })
})
