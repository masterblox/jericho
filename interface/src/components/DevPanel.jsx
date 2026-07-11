import React from 'react'
import { api, store } from '../jericho-api'

// Dev-only test harness: drives window.jericho so the core's answer states
// can be exercised before the voice/gesture bridge is wired in.

export function DevPanel() {
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const voiceLoop = React.useRef(0)
  const sequenceTimers = React.useRef([])

  const stopSims = React.useCallback(() => {
    cancelAnimationFrame(voiceLoop.current)
    sequenceTimers.current.forEach(clearTimeout)
    sequenceTimers.current = []
    api.setLevel(0)
  }, [])

  React.useEffect(() => stopSims, [stopSims])

  // speech-like envelope: syllable bursts with pauses, not a plain sine
  const startVoice = React.useCallback(() => {
    stopSims()
    api.setCoreState('speaking')
    const started = performance.now()
    const tick = now => {
      const t = (now - started) / 1000
      const syllables = Math.abs(Math.sin(t * 7.3)) * (0.6 + 0.4 * Math.sin(t * 1.7))
      const pause = Math.sin(t * 0.9) > -0.35 ? 1 : 0.08
      api.setLevel(0.12 + syllables * pause * 0.88)
      voiceLoop.current = requestAnimationFrame(tick)
    }
    voiceLoop.current = requestAnimationFrame(tick)
  }, [stopSims])

  const setState = state => () => { stopSims(); api.setCoreState(state) }

  // a full fake exchange: wake -> think -> answer -> settle
  const runSequence = React.useCallback(() => {
    stopSims()
    api.setCoreState('listening')
    api.toast('SEQUENCE · LISTENING')
    const at = (ms, fn) => sequenceTimers.current.push(setTimeout(fn, ms))
    at(1800, () => { api.setCoreState('thinking'); api.toast('SEQUENCE · THINKING') })
    at(4200, () => { startVoice(); api.toast('SEQUENCE · SPEAKING') })
    at(9200, () => { stopSims(); api.setCoreState('idle'); api.toast('SEQUENCE · COMPLETE') })
  }, [stopSims, startVoice])

  const states = ['idle', 'listening', 'thinking', 'alert']
  return <div className="dev-panel" aria-label="Core state test harness">
    <span className="micro dev-tag">TEST</span>
    {states.map(s => (
      <button key={s} className={state.coreState === s ? 'active' : ''} onClick={setState(s)}>{s.toUpperCase()}</button>
    ))}
    <button className={state.coreState === 'speaking' ? 'active' : ''} onClick={startVoice}>SPEAKING</button>
    <button className="seq" onClick={runSequence}>▶ SEQUENCE</button>
    <button onClick={() => api.setMode(state.mode === 'jarvis' ? 'megatron' : 'jarvis')}>
      {state.mode === 'jarvis' ? 'MEGATRON' : 'JARVIS'}
    </button>
    <button onClick={() => api.dispatch('Recover Paperclip and verify all 71 closures')}>DISPATCH</button>
  </div>
}
