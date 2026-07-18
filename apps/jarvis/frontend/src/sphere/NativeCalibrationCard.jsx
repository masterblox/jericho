import React from 'react'
import { JerichoCard, Chip } from './components/JerichoCard'

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

  React.useEffect(() => {
    const handler = (event) => {
      if (event.detail && typeof event.detail.phase === 'string') {
        setSnapshot(event.detail)
      }
    }
    document.addEventListener(JERICHO_AUDIO_CALIBRATION_STATE_EVENT, handler)
    return () => document.removeEventListener(JERICHO_AUDIO_CALIBRATION_STATE_EVENT, handler)
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
      eyebrow="NATIVE CALIBRATION"
      source="LOCAL"
      chip={chip}
      chipTone={chipTone}
      big={PHASE_LABELS[phase] ?? phase.toUpperCase()}
      label="ROOM · SPEECH · CLAP · LIVE CANARY"
      provenance={snapshot.microphoneLabel ? `MIC: ${snapshot.microphoneLabel}` : undefined}
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

        {snapshot.proposalId && (
          <p className="native-calibration__proposal">PROPOSAL: {snapshot.proposalId.slice(0, 12)}&hellip;</p>
        )}

        {snapshot.deadlineRemainingMs !== undefined && (
          <p className="native-calibration__deadline">DEADLINE: {(snapshot.deadlineRemainingMs / 1000).toFixed(0)}s</p>
        )}

        {snapshot.candidateProfile && (
          <div className="native-calibration__candidate">
            <p>AMBIENT: {snapshot.candidateProfile.ambientNoiseFloor.toFixed(4)}</p>
            <p>SPEECH FLOOR: {snapshot.candidateProfile.speechActivationFloor.toFixed(4)}</p>
            <p>CLAP PEAK: {snapshot.candidateProfile.clapPeak.toFixed(4)}</p>
          </div>
        )}
      </div>

      <div className="native-calibration__actions">
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
        {isReview && (
          <>
            <button
              type="button"
              className="ok"
              data-gesture-target="cal:apply"
              data-jericho-active-calibration-decision="true"
              onClick={() => dispatchCommand('apply')}
            >
              CONFIRM
            </button>
            <button
              type="button"
              data-gesture-target="cal:discard"
              data-jericho-active-calibration-decision="true"
              onClick={() => dispatchCommand('discard')}
            >
              DISCARD
            </button>
          </>
        )}
        {!isReview && !isLiveCanary && !isFailed && (
          <button type="button" data-gesture-target="cal:exit" onClick={() => dispatchCommand('exit')}>
            EXIT
          </button>
        )}
      </div>
    </JerichoCard>
  )
}
