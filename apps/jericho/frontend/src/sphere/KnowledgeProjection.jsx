import React from 'react'
import { Chip, JerichoCard } from './components/JerichoCard'

// Generic grounded-knowledge constellation. Listens for the runtime's
// GroundedResultEvent and materializes native cards around the reactor:
// no dialog, no backdrop, no alternate dashboard. Cards persist until
// dismissed (edge eject, Escape, both-palms cancel) or replaced.
export const GROUNDED_RESULT_EVENT = 'jericho:grounded-result'
export const INTERFACE_SOUND_EVENT = 'jericho:interface-sound'
export const INTERFACE_SOUND_TOGGLE_EVENT = 'jericho:interface-sound-toggle'
export const INTERFACE_SOUND_MUTED_KEY = 'jericho.interfaceSound.muted.v1'
export const CANCEL_PENDING_EVENT = 'jericho:cancel-pending'

const SATELLITE_DELAY_MS = 120
const EDGE_EJECT_PX = 48
const TERMINAL_PHASES = new Set(['resolved', 'ambiguous', 'unavailable'])

const readMuted = () => {
  try { return localStorage.getItem(INTERFACE_SOUND_MUTED_KEY) === 'true' } catch { return false }
}

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

const nearViewportEdge = point => Boolean(point)
  && (point.x <= EDGE_EJECT_PX || point.y <= EDGE_EJECT_PX
    || point.x >= window.innerWidth - EDGE_EJECT_PX || point.y >= window.innerHeight - EDGE_EJECT_PX)

// Draggable positioning shell: pointer drag and gesture drag update the
// card offset; releasing within EDGE_EJECT_PX of a viewport edge ejects
// this card only. Delete/Backspace on the focused card is keyboard parity.
function ConstellationCard({ cardId, className, label, onEject, children }) {
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const element = React.useRef(null)
  const press = React.useRef(null)
  const offsetRef = React.useRef(offset)
  offsetRef.current = offset

  const release = (point, moved) => {
    if (moved && nearViewportEdge(point)) onEject(cardId)
  }

  const onPointerDown = event => {
    if (event.button !== undefined && event.button !== 0) return
    if (event.target.closest?.('button, a, input, textarea, select')) return
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* pointer capture is best-effort */ }
    press.current = {
      pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      baseX: offsetRef.current.x, baseY: offsetRef.current.y,
      moved: false,
    }
  }
  const onPointerMove = event => {
    const active = press.current
    if (!active || active.pointerId !== event.pointerId) return
    const x = active.baseX + event.clientX - active.startX
    const y = active.baseY + event.clientY - active.startY
    if (Math.abs(event.clientX - active.startX) + Math.abs(event.clientY - active.startY) > 4) active.moved = true
    setOffset({ x, y })
  }
  const onPointerUp = event => {
    const active = press.current
    if (!active || active.pointerId !== event.pointerId) return
    press.current = null
    release({ x: event.clientX, y: event.clientY }, active.moved)
  }

  React.useEffect(() => {
    const node = element.current
    if (!node) return
    const move = event => {
      const delta = event.detail?.delta
      if (delta) setOffset(current => ({ x: current.x + (delta.x ?? 0), y: current.y + (delta.y ?? 0) }))
    }
    const end = event => {
      if (event.detail?.cancelled) return
      release(event.detail?.point, true)
    }
    node.addEventListener('jericho:drag-move', move)
    node.addEventListener('jericho:drag-end', end)
    return () => {
      node.removeEventListener('jericho:drag-move', move)
      node.removeEventListener('jericho:drag-end', end)
    }
  }, [onEject, cardId])

  return <div
    ref={element}
    className={`k-card ${className}`}
    style={{ '--dx': `${offset.x}px`, '--dy': `${offset.y}px` }}
    role="group"
    aria-label={label}
    tabIndex={0}
    data-knowledge-card={cardId}
    data-gesture-target={`knowledge:${cardId}`}
    data-gesture-draggable="true"
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onKeyDown={event => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (event.target.closest?.('button, a, input, textarea, select')) return
        event.preventDefault()
        onEject(cardId)
      }
    }}
  >{children}</div>
}

export function KnowledgeProjection({ actions = {} }) {
  const [muted, setMuted] = React.useState(readMuted)
  const [result, setResult] = React.useState(null)
  const [stage, setStage] = React.useState(0)
  const [ejected, setEjected] = React.useState(() => new Set())
  const [status, setStatus] = React.useState('')
  const [proposal, setProposal] = React.useState(null)
  const [correction, setCorrection] = React.useState(null)
  const mutedRef = React.useRef(muted)
  mutedRef.current = muted
  const resultRef = React.useRef(null)
  resultRef.current = result
  const timers = React.useRef([])
  const emittedCues = React.useRef(new Set())
  const reducedMotion = prefersReducedMotion()

  const cue = React.useCallback((resultId, name) => {
    if (mutedRef.current) return
    const key = `${resultId}:${name}`
    if (emittedCues.current.has(key)) return
    emittedCues.current.add(key)
    document.dispatchEvent(new CustomEvent(INTERFACE_SOUND_EVENT, { detail: { resultId, cue: name } }))
  }, [])

  const clearTimers = () => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
  }

  const dismissAll = React.useCallback(() => {
    const current = resultRef.current
    if (!current) return
    clearTimers()
    cue(current.resultId, 'dismiss')
    setResult(null); setStage(0); setEjected(new Set()); setStatus(''); setProposal(null); setCorrection(null)
  }, [cue])

  React.useEffect(() => {
    const onResult = event => {
      const detail = event.detail
      if (!detail || typeof detail.resultId !== 'string' || detail.resultId === '') return
      const current = resultRef.current
      if (current && current.resultId === detail.resultId && current.phase === detail.phase) return
      clearTimers()
      setEjected(new Set()); setStatus(''); setProposal(null); setCorrection(null)
      if (detail.phase === 'retrieving') {
        // Sphere pulse only — no cards until evidence lands.
        setResult(detail); setStage(0)
        cue(detail.resultId, 'retrieve')
        return
      }
      if (!TERMINAL_PHASES.has(detail.phase)) return
      setResult(detail); setStage(1)
      cue(detail.resultId, 'summon')
      if ((detail.provenance ?? []).length > 0) {
        timers.current.push(setTimeout(() => { setStage(previous => Math.max(previous, 2)); cue(detail.resultId, 'satellite') }, SATELLITE_DELAY_MS))
      }
      const actions = detail.actions ?? {}
      if (actions.open_note || actions.reorganize_notes || actions.correct_identity) {
        timers.current.push(setTimeout(() => { setStage(3); cue(detail.resultId, 'lock') }, SATELLITE_DELAY_MS * 2))
      }
    }
    document.addEventListener(GROUNDED_RESULT_EVENT, onResult)
    return () => { document.removeEventListener(GROUNDED_RESULT_EVENT, onResult); clearTimers() }
  }, [cue])

  // Both-palms cancellation dismisses the constellation unless an exact-plan
  // approval is on screen — that approval owns the cancel gesture.
  React.useEffect(() => {
    const onCancel = () => {
      if (!resultRef.current) return
      if (document.querySelector('[data-jericho-active-approval="true"]')) return
      dismissAll()
    }
    document.addEventListener(CANCEL_PENDING_EVENT, onCancel)
    return () => document.removeEventListener(CANCEL_PENDING_EVENT, onCancel)
  }, [dismissAll])

  React.useEffect(() => {
    const onKey = event => {
      if (event.key !== 'Escape' || !resultRef.current) return
      if (document.querySelector('.sphere-command:not([hidden])')) return
      if (document.querySelector('.modal-backdrop')) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      dismissAll()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dismissAll])

  React.useEffect(() => {
    const onToggle = event => {
      const next = typeof event.detail?.muted === 'boolean' ? event.detail.muted : !mutedRef.current
      try { localStorage.setItem(INTERFACE_SOUND_MUTED_KEY, next ? 'true' : 'false') } catch { /* local-only preference */ }
      setMuted(next)
    }
    document.addEventListener(INTERFACE_SOUND_TOGGLE_EVENT, onToggle)
    return () => document.removeEventListener(INTERFACE_SOUND_TOGGLE_EVENT, onToggle)
  }, [])

  const toggleMuted = () => {
    const next = !mutedRef.current
    try { localStorage.setItem(INTERFACE_SOUND_MUTED_KEY, next ? 'true' : 'false') } catch { /* local-only preference */ }
    setMuted(next)
    document.dispatchEvent(new CustomEvent(INTERFACE_SOUND_TOGGLE_EVENT, { detail: { muted: next } }))
  }

  const eject = React.useCallback(cardId => {
    const current = resultRef.current
    if (!current) return
    cue(current.resultId, 'dismiss')
    setEjected(previous => new Set(previous).add(cardId))
  }, [cue])

  const terminal = result && TERMINAL_PHASES.has(result.phase)
  const provenance = result?.provenance ?? []
  const permitted = result?.actions ?? {}
  const hasActions = Boolean(permitted.open_note || permitted.reorganize_notes || permitted.correct_identity)
  const cardIds = terminal
    ? ['primary', ...(provenance.length ? ['provenance'] : []), ...(hasActions ? ['actions'] : [])]
    : []

  // Every card individually ejected → the constellation is gone.
  React.useEffect(() => {
    if (!terminal || cardIds.some(id => !ejected.has(id))) return
    clearTimers()
    setResult(null); setStage(0); setEjected(new Set()); setStatus(''); setProposal(null); setCorrection(null)
  }, [terminal, ejected])

  const runAction = async (done, operation) => {
    setStatus('WORKING')
    try {
      await operation()
      setStatus(done)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'ACTION FAILED')
    }
  }

  const identity = result?.fullName ?? result?.canonicalIdentity ?? null
  const relationship = result?.relationship ?? null
  const employment = (result?.employment ?? []).map(item => typeof item === 'string' ? item : item?.org ?? '')
  const guided = result?.guided ?? null
  const guidedChip = guided ? (result?.phase === 'resolved' ? 'PASS' : 'LIVE') : null
  const primaryPath = permitted.open_note ?? provenance[0]?.relativePath
  const excerpt = provenance[0]?.excerpt
  const subject = result?.subject ?? ''

  const openNote = () => runAction('NOTE OPENED', () => primaryPath
    ? actions.openMemory(primaryPath)
    : Promise.reject(new Error('NO SOURCE NOTE')))
  const reorganize = () => runAction('REORGANIZATION PROPOSED', async () => {
    if (!primaryPath) throw new Error('NO SOURCE NOTE')
    if (!actions.proposeNoteReorganization) throw new Error('NOT AVAILABLE')
    const response = await actions.proposeNoteReorganization({ relativePath: primaryPath, title: identity ?? subject })
    setProposal(response?.proposal ?? null)
    return response
  })
  const correct = () => runAction('CORRECTION PREVIEW READY', async () => {
    if (!actions.correctIdentity) throw new Error('NOT AVAILABLE')
    setCorrection(await actions.correctIdentity())
  })
  const confirmCorrection = () => runAction('CORRECTION CONFIRMED', () => actions.confirmCorrection
    ? actions.confirmCorrection(correction)
    : Promise.reject(new Error('NOT AVAILABLE')))
  const decideReorganization = outcome => runAction(`REORGANIZATION ${outcome.toUpperCase()}`, () => {
    if (!actions.decideProposal || !proposal?.integrityHash) return Promise.reject(new Error('NOT AVAILABLE'))
    return actions.decideProposal({
      proposalId: proposal.id,
      proposalHash: proposal.integrityHash,
      version: proposal.version,
      outcome,
      reason: `${outcome === 'approved' ? 'Approved' : 'Rejected'} grounded knowledge reorganization preview`,
    })
  })

  return <div
    className="knowledge-projection"
    data-phase={result?.phase ?? 'idle'}
    data-reduced-motion={reducedMotion ? 'true' : undefined}
    aria-label="Grounded knowledge projection"
  >
    <button
      type="button"
      className="k-sound-toggle micro"
      aria-pressed={muted}
      aria-label="Interface sound"
      data-gesture-target="knowledge:sound-toggle"
      onClick={toggleMuted}
    >{muted ? 'SND MUTED' : 'SND ON'}</button>

    {terminal && stage >= 1 && !ejected.has('primary') && <ConstellationCard
      cardId="primary" className="k-card--primary" onEject={eject}
      label={`Grounded ${result.phase} card`}
    >
      {result.phase === 'resolved' && <JerichoCard
        eyebrow={`GROUNDED · ${String(result.route ?? 'RETRIEVAL').toUpperCase()}`}
        source="OBSIDIAN"
        chip={guided ? guidedChip : 'SOURCE-BACKED'}
        chipTone="ok"
        big={identity ?? subject}
        label={guided ? 'PERSON · GUIDED TEST' : 'PERSON · GROUNDED KNOWLEDGE'}
        provenance={`SOURCE · ${primaryPath ?? 'unknown'} · ${result.retrievalCount ?? 0} RETRIEVAL`}
      >
        <div className="k-chips">
          {guided && <Chip tone="dim">TEST</Chip>}
          {relationship && <Chip>{String(relationship).toUpperCase()}</Chip>}
          {employment.filter(Boolean).map(org => <Chip key={org}>{org.toUpperCase()}</Chip>)}
        </div>
        {relationship && <p className="k-evidence micro">RELATION · {String(relationship).toUpperCase()}</p>}
        {excerpt && <p className="k-excerpt">{excerpt}</p>}
        {result.confidence && <p className="k-evidence micro">CONFIDENCE · {String(result.confidence).toUpperCase()}</p>}
      </JerichoCard>}

      {result.phase === 'ambiguous' && <JerichoCard
        eyebrow={`GROUNDED · ${String(result.route ?? 'RETRIEVAL').toUpperCase()}`}
        source="OBSIDIAN"
        chip={guided ? guidedChip : 'AMBIGUOUS'}
        chipTone="dim"
        big={subject}
        label="AMBIGUOUS EVIDENCE · BINDINGS KEPT SEPARATE"
        provenance={`${provenance.length} EVIDENCE PATHS · ${result.retrievalCount ?? 0} RETRIEVAL`}
      >
        {guided && <div className="k-chips"><Chip tone="dim">TEST</Chip></div>}
        {excerpt && <p className="k-excerpt">{excerpt}</p>}
        <ol className="k-candidates">
          {provenance.map((entry, index) => <li key={entry.relativePath ?? index}>
            <strong>{entry.title ?? 'AMBIGUOUS EVIDENCE'}</strong>
            <span>{entry.relativePath ?? ''}</span>
          </li>)}
        </ol>
      </JerichoCard>}

      {result.phase === 'unavailable' && <JerichoCard
        tone="fault"
        eyebrow={`GROUNDED · ${String(result.route ?? 'RETRIEVAL').toUpperCase()}`}
        source="OBSIDIAN"
        chip={guided ? guidedChip : 'UNAVAILABLE'}
        chipTone="fault"
        big={subject || 'NO EVIDENCE'}
        label="NO CANONICAL EVIDENCE · NOTHING FABRICATED"
        provenance={`${result.retrievalCount ?? 0} RETRIEVAL`}
      >
        {guided && <div className="k-chips"><Chip tone="dim">TEST</Chip></div>}
        <p className="k-excerpt">{result.reason ?? 'The vault returned no canonical evidence for this subject.'}</p>
      </JerichoCard>}
    </ConstellationCard>}

    {terminal && stage >= 2 && provenance.length > 0 && !ejected.has('provenance') && <ConstellationCard
      cardId="provenance" className="k-card--provenance" onEject={eject}
      label="Provenance card"
    >
      <JerichoCard
        eyebrow="PROVENANCE"
        source="VAULT"
        chip={guided ? guidedChip : undefined}
        chipTone="ok"
        label={`${provenance.length} SOURCE ${provenance.length === 1 ? 'PATH' : 'PATHS'}`}
        provenance="EVERY CLAIM IS PATH-BACKED"
      >
        <ol className="k-provenance">
          {provenance.map(entry => <li key={entry.relativePath}>
            <code>{entry.relativePath}</code>
            {entry.title && <span className="micro">{entry.title}</span>}
          </li>)}
        </ol>
      </JerichoCard>
    </ConstellationCard>}

    {terminal && stage >= 3 && hasActions && !ejected.has('actions') && <ConstellationCard
      cardId="actions" className="k-card--actions" onEject={eject}
      label="Permitted actions plate"
    >
      <JerichoCard
        eyebrow="PERMITTED ACTIONS"
        source="JERICHO CORE"
        chip={guided ? guidedChip : undefined}
        chipTone="ok"
        label="REVIEW-GATED · NOTHING WRITTEN WITHOUT APPROVAL"
        provenance="AUTHENTICATED CORE CALLBACKS ONLY"
      >
        <div className="k-actions">
          {permitted.open_note && <button type="button" data-gesture-target="knowledge:open-note" onClick={() => void openNote()}>OPEN NOTE</button>}
          {permitted.reorganize_notes && <button type="button" data-gesture-target="knowledge:reorganize" onClick={() => void reorganize()}>REORGANIZE</button>}
          {permitted.correct_identity && <button type="button" data-gesture-target="knowledge:correct" onClick={() => void correct()}>CORRECT</button>}
          {correction && <button type="button" className="ok" data-gesture-target="knowledge:correct-confirm" onClick={() => void confirmCorrection()}>CONFIRM CORRECTION</button>}
        </div>
        {proposal?.integrityHash && <div className="k-review" aria-label="Reorganization review">
          <p>{proposal.summary ?? 'Review the exact reorganization proposal before recording a decision.'}</p>
          <div className="k-actions">
            <button type="button" className="ok" data-gesture-target="knowledge:reorganize-approve" onClick={() => void decideReorganization('approved')}>APPROVE REORGANIZATION</button>
            <button type="button" data-gesture-target="knowledge:reorganize-reject" onClick={() => void decideReorganization('rejected')}>REJECT REORGANIZATION</button>
          </div>
        </div>}
        {status && <p className="k-status micro" role="status">{status}</p>}
      </JerichoCard>
    </ConstellationCard>}
  </div>
}
