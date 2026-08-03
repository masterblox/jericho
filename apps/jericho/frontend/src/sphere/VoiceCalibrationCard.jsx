import React from 'react'
import { BreakdownRow, Chip, JerichoCard } from './components/JerichoCard'

const STORAGE_KEY = 'jericho.voice.preset.v1'
const DEFAULT_SENTENCE = 'Hello, sir. Jericho systems are online and at your disposal.'

export function VoiceCalibrationCard() {
  const [voices, setVoices] = React.useState([])
  const [selected, setSelected] = React.useState(() => readStoredVoice() ?? 'Algieba')
  const [confirmed, setConfirmed] = React.useState(() => readStoredVoice())
  const [previewId, setPreviewId] = React.useState('')
  const [previewStatus, setPreviewStatus] = React.useState('idle')
  const [sentence, setSentence] = React.useState(DEFAULT_SENTENCE)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    const onVoices = event => {
      const list = Array.isArray(event.detail?.voices) ? event.detail.voices : []
      setVoices(list)
      if (typeof event.detail?.auditionSentence === 'string') setSentence(event.detail.auditionSentence)
      const nextConfirmed = typeof event.detail?.confirmed === 'string' ? event.detail.confirmed : undefined
      if (nextConfirmed) {
        setConfirmed(nextConfirmed)
        setSelected(nextConfirmed)
        writeStoredVoice(nextConfirmed)
      } else if (!readStoredVoice() && typeof event.detail?.active === 'string') {
        setSelected(event.detail.active)
      }
    }
    const onPreview = event => {
      if (event.detail?.previewId && previewId && event.detail.previewId !== previewId) return
      setPreviewStatus(event.detail?.status ?? 'idle')
      if (event.detail?.status === 'unavailable') setError('VOICE UNAVAILABLE')
      if (event.detail?.status === 'complete' || event.detail?.status === 'cancelled') setPreviewId('')
    }
    const onConfirmed = event => {
      if (typeof event.detail?.voice !== 'string') return
      setConfirmed(event.detail.voice)
      setSelected(event.detail.voice)
      writeStoredVoice(event.detail.voice)
      setPreviewStatus('idle')
      setError('')
    }
    document.addEventListener('jericho:voices', onVoices)
    document.addEventListener('jericho:voice-preview', onPreview)
    document.addEventListener('jericho:voice-confirmed', onConfirmed)
    return () => {
      document.removeEventListener('jericho:voices', onVoices)
      document.removeEventListener('jericho:voice-preview', onPreview)
      document.removeEventListener('jericho:voice-confirmed', onConfirmed)
    }
  }, [previewId])

  const audition = voice => {
    setError('')
    setSelected(voice)
    const id = crypto.randomUUID()
    setPreviewId(id)
    setPreviewStatus('playing')
    document.dispatchEvent(new CustomEvent('jericho:preview-voice', { detail: { voice, previewId: id } }))
  }

  const cancel = () => {
    document.dispatchEvent(new CustomEvent('jericho:cancel-voice-preview'))
    setPreviewStatus('cancelled')
    setPreviewId('')
  }

  const confirm = () => {
    document.dispatchEvent(new CustomEvent('jericho:confirm-voice', { detail: { voice: selected } }))
  }

  const chip = previewStatus === 'playing' ? 'AUDITION' : confirmed ? 'SET' : 'FALLBACK'
  const chipTone = previewStatus === 'playing' ? 'warn' : confirmed ? 'ok' : ''

  return <JerichoCard
    className="voice-calibration"
    eyebrow="VOICE CALIBRATION"
    source="GEMINI LIVE"
    chip={chip}
    chipTone={chipTone}
    big={selected}
    label="CANONICAL JERICHO PRESENTATION PRESET"
    provenance={confirmed ? `CONFIRMED · ${confirmed}` : 'ALGIEBA FALLBACK UNTIL CONFIRMED'}
  >
    <p className="voice-calibration__sentence">{sentence}</p>
    <div className="voice-calibration__voices" role="listbox" aria-label="Gemini voices">
      {(voices.length ? voices : [selected]).map(voice => (
        <button
          key={voice}
          type="button"
          role="option"
          aria-selected={selected === voice}
          data-gesture-target={`voice:${voice}`}
          className={selected === voice ? 'is-selected' : ''}
          onClick={() => audition(voice)}
        >{voice}{confirmed === voice ? <Chip tone="ok">LIVE</Chip> : null}</button>
      ))}
    </div>
    <BreakdownRow label="PREVIEW" value={previewStatus.toUpperCase()} />
    <div className="voice-calibration__actions">
      <button type="button" data-gesture-target="voice:cancel" onClick={cancel} disabled={previewStatus !== 'playing'}>CANCEL PREVIEW</button>
      <button type="button" className="ok" data-gesture-target="voice:confirm" onClick={confirm}>CONFIRM VOICE</button>
    </div>
    {error && <p className="sphere-command__error" role="alert">{error}</p>}
  </JerichoCard>
}

function readStoredVoice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return typeof parsed?.voice === 'string' ? parsed.voice : undefined
  } catch {
    return undefined
  }
}

function writeStoredVoice(voice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ voice, confirmedAt: new Date().toISOString() }))
  } catch {
    /* private mode */
  }
}
