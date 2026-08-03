// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VoiceCalibrationCard } from '../src/sphere/VoiceCalibrationCard'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
