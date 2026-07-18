// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeCalibrationCard } from '../src/sphere/NativeCalibrationCard'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NativeCalibrationCard', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<NativeCalibrationCard />)
    expect(container.innerHTML).toBe('')
  })

  it('renders room phase after state event', () => {
    const { container } = render(<NativeCalibrationCard />)

    act(() => {
      document.dispatchEvent(new CustomEvent('jericho:audio-calibration-state', {
        detail: {
          sessionId: 'cal-1',
          phase: 'room',
          completedPhases: [],
          speechChecks: [],
          clapCount: 0,
          microphoneLabel: 'Test Mic',
          deadlineRemainingMs: 5000,
        },
      }))
    })

    expect(container.textContent).toContain('ROOM')
    expect(container.textContent).toContain('Test Mic')
  })

  it('shows failed state with retry action', () => {
    const commandEvents: any[] = []
    document.addEventListener('jericho:audio-calibration-command', (e) => commandEvents.push((e as CustomEvent).detail))

    const { container } = render(<NativeCalibrationCard />)

    act(() => {
      document.dispatchEvent(new CustomEvent('jericho:audio-calibration-state', {
        detail: {
          sessionId: 'cal-2',
          phase: 'failed',
          failureReason: 'excessive_ambient_noise',
          failedPhase: 'room',
          completedPhases: [],
          speechChecks: [],
          clapCount: 0,
        },
      }))
    })

    expect(container.textContent).toContain('FAILED')
    expect(container.textContent).toContain('EXCESSIVE AMBIENT NOISE')
    expect(container.textContent).toContain('RETRY PHASE')

    document.removeEventListener('jericho:audio-calibration-command', () => {})
  })

  it('shows review state with confirm/discard', () => {
    const { container } = render(<NativeCalibrationCard />)

    act(() => {
      document.dispatchEvent(new CustomEvent('jericho:audio-calibration-state', {
        detail: {
          sessionId: 'cal-3',
          phase: 'review',
          completedPhases: ['room', 'speech', 'clap', 'live_canary'],
          speechChecks: [
            { phraseId: 'voice_range_1', passed: true },
            { phraseId: 'voice_range_2', passed: true },
            { phraseId: 'voice_range_3', passed: true },
          ],
          clapCount: 3,
          liveResultId: 'result-abc-123',
          candidateProfile: {
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            ambientNoiseFloor: 0.012,
            speechActivationFloor: 0.05,
            clapPeak: 0.85,
            clapRms: 0.12,
            clapCrest: 7.1,
            liveResultId: 'result-abc-123',
          },
        },
      }))
    })

    expect(container.textContent).toContain('REVIEW')
    expect(container.textContent).toContain('CONFIRM')
    expect(container.textContent).toContain('DISCARD')
  })
})
