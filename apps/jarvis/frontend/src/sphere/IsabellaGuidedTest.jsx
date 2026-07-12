import React from 'react'
import { Chip, JerichoCard } from './components/JerichoCard'

const EMPTY = { phase: 'ask', result: null, proposal: null, outcome: null, error: '' }

export function IsabellaGuidedTest({ session, active = true, actions }) {
  const [state, setState] = React.useState(EMPTY)
  const personCard = React.useRef(null)
  const activeRef = React.useRef(active)
  activeRef.current = active

  React.useEffect(() => setState(EMPTY), [session])
  React.useEffect(() => {
    const receive = event => {
      if (!activeRef.current) return
      if (event.detail?.name !== 'search_vault') return
      const result = bestIsabellaResult(event.detail.result?.results)
      if (!result) {
        setState(current => ({ ...current, error: 'NO ISABELLA NOTE RETURNED BY THE VAULT' }))
        return
      }
      setState({ phase: 'inspect', result, proposal: null, outcome: null, error: '' })
    }
    document.addEventListener('jericho:voice-tool-result', receive)
    return () => document.removeEventListener('jericho:voice-tool-result', receive)
  }, [])

  const open = async () => {
    if (!state.result) return
    try {
      await actions.openMemory(state.result.path)
      setState(current => ({ ...current, phase: 'drag', error: '' }))
    } catch (error) {
      setState(current => ({ ...current, error: error instanceof Error ? error.message : 'OPEN FAILED' }))
    }
  }

  const propose = async () => {
    if (!state.result || state.phase !== 'drag') return
    setState(current => ({ ...current, phase: 'proposing', error: '' }))
    try {
      const response = await actions.proposeNoteReorganization({
        relativePath: state.result.path,
        title: state.result.title,
      })
      setState(current => ({ ...current, phase: 'review', proposal: response.proposal, error: '' }))
    } catch (error) {
      setState(current => ({ ...current, phase: 'drag', error: error instanceof Error ? error.message : 'PROPOSAL FAILED' }))
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
    if (!card || state.phase !== 'drag') return
    card.addEventListener('jericho:drag-end', onGestureDrop)
    return () => card.removeEventListener('jericho:drag-end', onGestureDrop)
  }, [state.phase, state.result])

  return <div className="isabella-test" aria-label="Isabella guided test">
    <div className="isabella-test__progress" aria-label="Test progress">
      <TestStep number="01" label="ASK" status={stepStatus(state.phase, 'ask')} />
      <TestStep number="02" label="OPEN" status={stepStatus(state.phase, 'inspect')} />
      <TestStep number="03" label="DRAG" status={stepStatus(state.phase, 'drag')} />
      <TestStep number="04" label="REVIEW" status={stepStatus(state.phase, 'review')} />
    </div>

    {state.phase === 'ask' && <JerichoCard eyebrow="TEST 01 · ASK" source="VOICE" chip="LIVE" big="ISABELLA" label="Say: Who is Isabella?" provenance="WAITING FOR BOUNDED search_vault EVIDENCE">
      <p className="isabella-test__instruction">Jarvis will search your private Obsidian evidence and materialize the matching person card.</p>
    </JerichoCard>}

    {state.result && <div className="isabella-test__workspace">
      <JerichoCard
        eyebrow={state.phase === 'inspect' ? 'TEST 02 · OPEN' : 'TEST 03 · DRAG'}
        source="OBSIDIAN"
        chip={state.phase === 'inspect' ? 'LIVE' : 'PASS'}
        chipTone={state.phase === 'inspect' ? '' : 'ok'}
        big={state.result.title}
        label="PERSON · FAMILY + MASTERBLOX CONTEXT"
        provenance={`SOURCE · ${state.result.path}`}
        className="isabella-test__person"
        ref={personCard}
        tabIndex={0}
        role="button"
        data-gesture-target="guided:isabella-card"
        data-gesture-draggable={state.phase === 'drag' ? 'true' : undefined}
        draggable={state.phase === 'drag'}
        onDragStart={event => event.dataTransfer?.setData('text/plain', 'isabella')}
      >
        <div className="isabella-test__chips"><Chip>WIFE</Chip><Chip>MASTERBLOX</Chip><Chip tone="ok">SOURCE-BACKED</Chip></div>
        <p>{state.result.excerpt}</p>
        {state.phase === 'inspect' && <button type="button" data-gesture-target="guided:isabella-open" onClick={() => void open()}>OPEN IN OBSIDIAN</button>}
      </JerichoCard>

      {(state.phase === 'drag' || state.phase === 'proposing') && <JerichoCard
        eyebrow="TEST 03 · DROP TARGET"
        source="LOCAL PREVIEW"
        chip={state.phase === 'proposing' ? 'WORKING' : 'LIVE'}
        big="REORGANIZE"
        label="NOTES · NO WRITE ON DROP"
        provenance="CREATES A REVIEW-GATED CORE PROPOSAL"
        className="isabella-test__drop"
        data-isabella-drop="reorganize"
        onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); void propose() }}
      ><p>Drag Isabella here to preview family and Masterblox organization changes.</p></JerichoCard>}
    </div>}

    {(state.phase === 'review' || state.phase === 'complete') && state.proposal && <JerichoCard
      eyebrow="TEST 04 · REVIEW"
      source="JERICHO CORE"
      chip={state.phase === 'complete' ? 'PASS' : 'LIVE'}
      chipTone={state.phase === 'complete' ? 'ok' : ''}
      big="PREVIEW"
      label="EXACT PROPOSAL · NOTHING WRITTEN"
      provenance={`V${state.proposal.version} · ${state.proposal.integrityHash}`}
    >
      <p>{state.proposal.summary}</p>
      <ol className="isabella-test__changes">{(state.proposal.body?.changes ?? []).map((change, index) => <li key={`${change.operation}:${index}`}><strong>{String(change.operation).replaceAll('_', ' ')}</strong><span>{String(change.value)}</span></li>)}</ol>
      {state.phase === 'review' ? <div className="isabella-test__actions">
        <button type="button" className="ok" data-gesture-target="guided:isabella-approve" onClick={() => void decide('approved')}>APPROVE PREVIEW</button>
        <button type="button" data-gesture-target="guided:isabella-reject" onClick={() => void decide('rejected')}>REJECT</button>
      </div> : <p className="isabella-test__verdict">CORE RECORDED · {state.outcome.toUpperCase()} · OBSIDIAN UNCHANGED</p>}
    </JerichoCard>}

    {state.error && <p className="sphere-command__error" role="alert">{state.error}</p>}
  </div>
}

function bestIsabellaResult(results) {
  if (!Array.isArray(results)) return null
  return results.find(result => /(?:^|[^\p{L}])isabella(?:[^\p{L}]|$)/iu.test(`${result?.title ?? ''} ${result?.path ?? ''}`)) ?? null
}

function TestStep({ number, label, status }) {
  return <span data-status={status}><b>{number}</b>{label}<i>{status}</i></span>
}

function stepStatus(phase, step) {
  const order = ['ask', 'inspect', 'drag', 'review', 'complete']
  const current = order.indexOf(phase === 'proposing' ? 'drag' : phase)
  const target = order.indexOf(step)
  return current > target ? 'PASS' : current === target ? 'LIVE' : 'WAIT'
}
