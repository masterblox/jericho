import React from 'react'
import { BreakdownRow, JerichoCard, Chip } from './components/JerichoCard'
import { computeCardPlacement, computeSphereExclusion, relativeRects } from './projection-geometry'
import { parseCalibrationSnapshot } from '../calibration-events'

const JERICHO_AUDIO_CALIBRATION_STATE_EVENT = 'jericho:audio-calibration-state'
const JERICHO_AUDIO_CALIBRATION_COMMAND_EVENT = 'jericho:audio-calibration-command'

const PHASE_LABELS = {
  idle: 'IDLE',
  room: 'ROOM',
  speech: 'SPEECH',
  clap: 'CLAP',
  live_canary: 'LIVE CANARY',
  review: 'REVIEW',
  saved: 'SAVED',
  failed: 'FAILED',
}

function dispatchCommand(action) {
  document.dispatchEvent(
    new CustomEvent(JERICHO_AUDIO_CALIBRATION_COMMAND_EVENT, { detail: { action } }),
  )
}

export function NativeCalibrationCard() {
  const [snapshot, setSnapshot] = React.useState(null)
  const [hold, setHold] = React.useState({ outcome: 'apply', ratio: 0 })
  const [placement, setPlacement] = React.useState(null)
  const cardRef = React.useRef(null)

  React.useEffect(() => {
    const handler = (event) => {
      const next = parseCalibrationSnapshot(event.detail)
      if (next) setSnapshot(next)
    }
    document.addEventListener(JERICHO_AUDIO_CALIBRATION_STATE_EVENT, handler)
    return () => document.removeEventListener(JERICHO_AUDIO_CALIBRATION_STATE_EVENT, handler)
  }, [])

  const measure = React.useCallback(() => {
    const card = cardRef.current
    const stage = card?.closest?.('.stage')
    const core = stage?.querySelector?.('.core-wrap')
    if (!card || !stage || !core) return
    const stageRect = stage.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const exclusion = computeSphereExclusion(core, stage)
    const occupied = relativeRects(stage.querySelectorAll('[data-knowledge-card]'), stage)
    setPlacement(computeCardPlacement(
      exclusion,
      { width: stageRect.width, height: stageRect.height },
      { width: cardRect.width || 340, height: card.scrollHeight || cardRect.height || 260 },
      occupied,
    ))
  }, [])

  React.useLayoutEffect(() => {
    if (!snapshot || snapshot.phase === 'idle' || snapshot.phase === 'saved') return
    measure()
    const card = cardRef.current
    const stage = card?.closest?.('.stage')
    const core = stage?.querySelector?.('.core-wrap')
    const ResizeObserverImpl = globalThis.ResizeObserver
    const MutationObserverImpl = globalThis.MutationObserver
    const resize = ResizeObserverImpl ? new ResizeObserverImpl(measure) : null
    if (card) resize?.observe(card)
    if (stage) resize?.observe(stage)
    if (core) resize?.observe(core)
    const mutations = stage && MutationObserverImpl ? new MutationObserverImpl(measure) : null
    mutations?.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase', 'class'] })
    window.addEventListener('resize', measure)
    return () => {
      resize?.disconnect()
      mutations?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, snapshot?.phase, snapshot?.clapCount, snapshot?.actionState])

  React.useEffect(() => {
    const stage = cardRef.current?.closest?.('.stage')
    if (!stage) return
    if (snapshot?.phase === 'room') stage.style.setProperty('--cal-noise-level', String(snapshot.roomLevel ?? 0))
    else stage.style.removeProperty('--cal-noise-level')
    return () => stage.style.removeProperty('--cal-noise-level')
  }, [snapshot?.phase, snapshot?.roomLevel])

  React.useEffect(() => {
    const handler = event => {
      const outcome = event.detail?.outcome
      const ratio = event.detail?.ratio
      if ((outcome !== 'apply' && outcome !== 'discard') || typeof ratio !== 'number' || !Number.isFinite(ratio)) return
      setHold({ outcome, ratio: Math.max(0, Math.min(1, ratio)) })
    }
    document.addEventListener('jericho:calibration-hold-progress', handler)
    return () => document.removeEventListener('jericho:calibration-hold-progress', handler)
  }, [])

  if (!snapshot || snapshot.phase === 'idle' || snapshot.phase === 'saved') return null

  const phase = snapshot.phase
  const isFailed = phase === 'failed'
  const isReview = phase === 'review'
  const isLiveCanary = phase === 'live_canary'
  const chip = isFailed ? 'FAILED' : isReview ? 'DECISION' : 'ACTIVE'
  const chipTone = isFailed ? 'error' : isReview ? 'warn' : ''

  return (
    <JerichoCard
      className="native-calibration"
      ref={cardRef}
      eyebrow="NATIVE CALIBRATION"
      source="LOCAL"
      chip={chip}
      chipTone={chipTone}
      big={PHASE_LABELS[phase] ?? phase.toUpperCase()}
      label="ROOM · SPEECH · CLAP · LIVE CANARY"
      provenance={snapshot.microphoneLabel ? `MIC: ${snapshot.microphoneLabel}` : undefined}
      data-jericho-active-calibration-decision={isReview ? 'true' : undefined}
      aria-live="polite"
      data-placement={placement?.side}
      data-flow={placement?.flow ? 'true' : undefined}
      style={placement ? {
        '--cal-x': `${placement.x}px`,
        '--cal-y': `${placement.y}px`,
        '--cal-width': `${placement.width}px`,
        '--cal-max-height': `${placement.maxHeight}px`,
      } : undefined}
    >
      <div className="native-calibration__content">
        {snapshot.completedPhases && snapshot.completedPhases.length > 0 && (
          <div className="native-calibration__completed">
            {snapshot.completedPhases.map((p) => (
              <Chip key={p} tone="ok">{p.replace(/_/g, ' ').toUpperCase()}</Chip>
            ))}
          </div>
        )}

        {snapshot.speechChecks && snapshot.speechChecks.length > 0 && (
          <div className="native-calibration__phrases">
            {snapshot.speechChecks.map((check, i) => (
              <Chip key={i} tone={check.passed ? 'ok' : 'error'}>
                {check.phraseId.replace(/_/g, ' ').toUpperCase()}
              </Chip>
            ))}
          </div>
        )}

        {snapshot.clapCount > 0 && (
          <p className="native-calibration__claps">CLAPS: {snapshot.clapCount} / 3</p>
        )}

        {phase === 'room' && <p className="native-calibration__instruction">Stay quiet while Jericho measures five seconds of room noise. LEVEL {Math.round((snapshot.roomLevel ?? 0) * 100)}%</p>}
        {phase === 'speech' && <p className="native-calibration__instruction">Repeat each displayed phrase after Jarvis finishes speaking.</p>}
        {phase === 'clap' && <p className="native-calibration__instruction">Make three distinct claps. Normal speech stays local and must not wake Jarvis.</p>}
        {isLiveCanary && <p className="native-calibration__instruction">Clap once to wake Jarvis, then ask: “Who’s Isabella?”</p>}

        {snapshot.liveResultId && (
          <p className="native-calibration__result">RESULT: {snapshot.liveResultId.slice(0, 12)}&hellip;</p>
        )}

        {snapshot.failureReason && (
          <p className="native-calibration__error" role="alert">
            {snapshot.failureReason.replace(/_/g, ' ').toUpperCase()}
          </p>
        )}

        {snapshot.actionState === 'working' && (
          <p className="native-calibration__working">WORKING&hellip;</p>
        )}
        {snapshot.actionState === 'failed' && (
          <p className="native-calibration__error" role="alert">ACTION FAILED — NOTHING WAS APPLIED</p>
        )}

        {isReview && (
          <p className="native-calibration__review-summary">4 PHASES PASSED · 3 PHRASES CLEAN · 3 CLAPS</p>
        )}

        {snapshot.proposalId && (
          <p className="native-calibration__proposal">PROPOSAL: {snapshot.proposalId.slice(0, 12)}&hellip;</p>
        )}

        {snapshot.deadlineRemainingMs !== undefined && (
          <p className="native-calibration__deadline">DEADLINE: {(snapshot.deadlineRemainingMs / 1000).toFixed(0)}s</p>
        )}

        {isReview && (
          <div className="native-calibration__decision-copy">
            <p>Calibration is ready. Confirm to apply.</p>
            <p className="micro">HOLD THUMB UP / DOWN FOR 700 MS · VOICE CANNOT APPLY</p>
            <div className="native-calibration__hold" role="progressbar" aria-label={`${hold.outcome} hold progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(hold.ratio * 100)}>
              <span style={{ '--hold-progress': hold.ratio }} />
            </div>
            <div className="native-calibration__actions">
              <button
                type="button"
                className="ok"
                data-gesture-target="cal:apply"
                onClick={() => dispatchCommand('apply')}
              >
                CONFIRM
              </button>
              <button
                type="button"
                data-gesture-target="cal:discard"
                onClick={() => dispatchCommand('discard')}
              >
                DISCARD
              </button>
            </div>
          </div>
        )}
        {snapshot.candidateProfile && (
          <div className="native-calibration__candidate">
            <BreakdownRow label="PREVIOUS CLAP" value={snapshot.previousProfile ? snapshot.previousProfile.clapPeak.toFixed(4) : 'DEFAULT'} />
            <BreakdownRow label="CANDIDATE CLAP" value={snapshot.candidateProfile.clapPeak.toFixed(4)} />
            <BreakdownRow label="AMBIENT" value={snapshot.candidateProfile.ambientNoiseFloor.toFixed(4)} />
            <BreakdownRow label="SPEECH FLOOR" value={snapshot.candidateProfile.speechActivationFloor.toFixed(4)} />
          </div>
        )}
      </div>

      {!isReview && <div className="native-calibration__actions">
        {isFailed && (
          <>
            <button type="button" data-gesture-target="cal:retry" onClick={() => dispatchCommand('retry_phase')}>
              RETRY PHASE
            </button>
            <button type="button" data-gesture-target="cal:fix" onClick={() => dispatchCommand('create_fix_proposal')}>
              CREATE FIX PROPOSAL
            </button>
          </>
        )}
        <button type="button" data-gesture-target="cal:exit" onClick={() => dispatchCommand('exit')}>
          EXIT
        </button>
      </div>}
    </JerichoCard>
  )
}
