import React from 'react'
import { Chip, JerichoCard } from './components/JerichoCard'

const EMPTY = {
  phase: 'ready',
  evidence: null,
  proposal: null,
  outcome: null,
  error: '',
}

const PHASES = [
  ['ready', 'READY'],
  ['retrieving', 'RETRIEVE'],
  ['presenting', 'PRESENT'],
  ['opening', 'OPEN'],
  ['correcting_organizing', 'ORGANIZE'],
  ['reviewing', 'REVIEW'],
  ['complete', 'DONE'],
]

export function IsabellaGuidedTest({ session, active = true, actions }) {
  const [state, setState] = React.useState(EMPTY)
  const personCard = React.useRef(null)
  const activeRef = React.useRef(active)
  activeRef.current = active

  React.useEffect(() => setState(EMPTY), [session])
  React.useEffect(() => {
    const onPhase = event => {
      if (!activeRef.current) return
      if (event.detail?.test !== 'isabella') return
      const phase = event.detail.phase
      const evidence = event.detail.evidence ?? null
      setState(current => ({
        ...current,
        phase: phase || current.phase,
        evidence: evidence || current.evidence,
        error: event.detail.error ? String(event.detail.error) : '',
      }))
    }
    const onTool = event => {
      if (!activeRef.current) return
      if (event.detail?.name !== 'identity_aware_retrieval') return
      setState(current => ({
        ...current,
        phase: current.phase === 'ready' || current.phase === 'retrieving' ? 'presenting' : current.phase,
        evidence: event.detail.result,
        error: event.detail.result?.resolved ? '' : 'NO CANONICAL ISABELLA HANDEL EVIDENCE',
      }))
    }
    document.addEventListener('jericho:guided-test-phase', onPhase)
    document.addEventListener('jericho:voice-tool-result', onTool)
    return () => {
      document.removeEventListener('jericho:guided-test-phase', onPhase)
      document.removeEventListener('jericho:voice-tool-result', onTool)
    }
  }, [])

  const resolved = state.evidence?.resolved
  const excluded = state.evidence?.excluded ?? []

  const open = async () => {
    if (!resolved?.provenance?.[0]?.relativePath) return
    try {
      const path = resolved.provenance[0].relativePath
      await actions.openMemory(path)
      document.dispatchEvent(new CustomEvent('jericho:guided-phase-complete', { detail: { phase: 'opening' } }))
      setState(current => ({ ...current, phase: 'opening', error: '' }))
      document.dispatchEvent(new CustomEvent('jericho:guided-phase-complete', { detail: { phase: 'correcting_organizing' } }))
      setState(current => ({ ...current, phase: 'correcting_organizing', error: '' }))
    } catch (error) {
      setState(current => ({ ...current, error: error instanceof Error ? error.message : 'OPEN FAILED' }))
    }
  }

  const propose = async () => {
    if (!resolved || (state.phase !== 'correcting_organizing' && state.phase !== 'opening')) return
    setState(current => ({ ...current, error: '' }))
    try {
      const response = await actions.proposeNoteReorganization({
        relativePath: resolved.provenance[0].relativePath,
        title: resolved.fullName,
      })
      document.dispatchEvent(new CustomEvent('jericho:guided-phase-complete', { detail: { phase: 'reviewing' } }))
      setState(current => ({ ...current, phase: 'reviewing', proposal: response.proposal, error: '' }))
    } catch (error) {
      setState(current => ({
        ...current,
        phase: 'correcting_organizing',
        error: error instanceof Error ? error.message : 'PROPOSAL FAILED',
      }))
    }
  }

  const decide = async outcome => {
    const proposal = state.proposal
    if (!proposal?.integrityHash) return
    try {
      await actions.decideProposal({
        proposalId: proposal.id,
        proposalHash: proposal.integrityHash,
        version: proposal.version,
        outcome,
        reason: `${outcome === 'approved' ? 'Approved' : 'Rejected'} Isabella guided-test preview`,
      })
      document.dispatchEvent(new CustomEvent('jericho:guided-phase-complete', { detail: { phase: 'complete' } }))
      setState(current => ({ ...current, phase: 'complete', outcome, error: '' }))
    } catch (error) {
      setState(current => ({ ...current, error: error instanceof Error ? error.message : 'DECISION FAILED' }))
    }
  }

  const onGestureDrop = event => {
    const point = event.detail?.point
    if (event.detail?.cancelled || !point) return
    const target = document.elementsFromPoint?.(point.x, point.y)
      .find(element => element.closest?.('[data-isabella-drop="reorganize"]'))
    if (target) void propose()
  }

  React.useEffect(() => {
    const card = personCard.current
    if (!card || state.phase !== 'correcting_organizing') return
    card.addEventListener('jericho:drag-end', onGestureDrop)
    return () => card.removeEventListener('jericho:drag-end', onGestureDrop)
  }, [state.phase, resolved])

  const organizing = state.phase === 'correcting_organizing' || state.phase === 'opening'

  return <div className="isabella-test" aria-label="Isabella guided test">
    <div className="isabella-test__progress" aria-label="Test progress">
      {PHASES.map(([id, label], index) => (
        <TestStep key={id} number={String(index + 1).padStart(2, '0')} label={label} status={stepStatus(state.phase, id)} />
      ))}
    </div>

    {(state.phase === 'ready' || state.phase === 'retrieving') && <JerichoCard
      eyebrow={state.phase === 'retrieving' ? 'PHASE · RETRIEVING' : 'PHASE · READY'}
      source="VOICE"
      chip={state.phase === 'retrieving' ? 'WORKING' : 'LIVE'}
      big="ISABELLA"
      label={state.phase === 'retrieving' ? 'Identity-aware vault retrieval in progress' : 'Say: Who is Isabella?'}
      provenance="ONE QUERY · NO SPECULATIVE NARRATION"
    >
      <p className="isabella-test__instruction">
        {state.phase === 'retrieving'
          ? 'Jarvis stays silent until resolved evidence returns.'
          : 'Jarvis will run exactly one identity-aware vault retrieval and materialize Isabella Handel when supported.'}
      </p>
    </JerichoCard>}

    {resolved && <div className="isabella-test__workspace">
      <JerichoCard
        eyebrow={organizing ? 'PHASE · ORGANIZE' : 'PHASE · PRESENT'}
        source="OBSIDIAN"
        chip={organizing ? 'PASS' : 'LIVE'}
        chipTone={organizing ? 'ok' : ''}
        big={resolved.fullName}
        label="PERSON · FAMILY + MASTERBLOX CONTEXT"
        provenance={`SOURCE · ${resolved.provenance[0]?.relativePath ?? 'unknown'}`}
        className="isabella-test__person"
        ref={personCard}
        tabIndex={0}
        role="button"
        data-gesture-target="guided:isabella-card"
        data-gesture-draggable={state.phase === 'correcting_organizing' ? 'true' : undefined}
        draggable={state.phase === 'correcting_organizing'}
        onDragStart={event => event.dataTransfer?.setData('text/plain', 'isabella')}
      >
        <div className="isabella-test__chips">
          {resolved.relationshipToCarlos && <Chip>WIFE</Chip>}
          {resolved.employment?.map(item => <Chip key={item}>{item.toUpperCase()}</Chip>)}
          <Chip tone="ok">SOURCE-BACKED</Chip>
        </div>
        <p>{resolved.provenance[0]?.excerpt}</p>
        {excluded.length > 0 && <p className="isabella-test__ambiguous">Ambiguous first-name evidence kept separate ({excluded.length}).</p>}
        {(state.phase === 'presenting' || state.phase === 'opening') && (
          <button type="button" data-gesture-target="guided:isabella-open" onClick={() => void open()}>OPEN IN OBSIDIAN</button>
        )}
      </JerichoCard>

      {organizing && <JerichoCard
        eyebrow="PHASE · DROP TARGET"
        source="LOCAL PREVIEW"
        chip="LIVE"
        big="REORGANIZE"
        label="NOTES · NO WRITE ON DROP"
        provenance="CREATES A REVIEW-GATED CORE PROPOSAL"
        className="isabella-test__drop"
        data-isabella-drop="reorganize"
        onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); void propose() }}
      ><p>Drag Isabella Handel here to preview family and MasterBlox organization changes.</p></JerichoCard>}
    </div>}

    {(state.phase === 'reviewing' || state.phase === 'complete') && state.proposal && <JerichoCard
      eyebrow="PHASE · REVIEW"
      source="JERICHO CORE"
      chip={state.phase === 'complete' ? 'PASS' : 'LIVE'}
      chipTone={state.phase === 'complete' ? 'ok' : ''}
      big="PREVIEW"
      label="EXACT PROPOSAL · NOTHING WRITTEN"
      provenance={`V${state.proposal.version} · ${state.proposal.integrityHash}`}
    >
      <p>{state.proposal.summary}</p>
      <ol className="isabella-test__changes">{(state.proposal.body?.changes ?? []).map((change, index) => <li key={`${change.operation}:${index}`}><strong>{String(change.operation).replaceAll('_', ' ')}</strong><span>{String(change.value)}</span></li>)}</ol>
      {state.phase === 'reviewing' ? <div className="isabella-test__actions">
        <button type="button" className="ok" data-gesture-target="guided:isabella-approve" onClick={() => void decide('approved')}>APPROVE PREVIEW</button>
        <button type="button" data-gesture-target="guided:isabella-reject" onClick={() => void decide('rejected')}>REJECT</button>
      </div> : <p className="isabella-test__verdict">CORE RECORDED · {state.outcome.toUpperCase()} · OBSIDIAN UNCHANGED</p>}
    </JerichoCard>}

    {state.error && <p className="sphere-command__error" role="alert">{state.error}</p>}
  </div>
}

function TestStep({ number, label, status }) {
  return <span data-status={status}><b>{number}</b>{label}<i>{status}</i></span>
}

function stepStatus(phase, step) {
  const order = PHASES.map(([id]) => id)
  const current = order.indexOf(phase)
  const target = order.indexOf(step)
  return current > target ? 'PASS' : current === target ? 'LIVE' : 'WAIT'
}
