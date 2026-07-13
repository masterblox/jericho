import React from 'react'
import { Chip, JerichoCard } from './components/JerichoCard'

export const GROUNDED_RESULT_EVENT = 'jericho:grounded-result'
export const INTERFACE_SOUND_EVENT = 'jericho:interface-sound'
export const INTERFACE_SOUND_TOGGLE_EVENT = 'jericho:interface-sound-toggle'
export const INTERFACE_SOUND_MUTED_KEY = 'jericho.interfaceSound.muted.v1'
export const CANCEL_PENDING_EVENT = 'jericho:cancel-pending'

const STAGGER_MS = 80
const CARD_GAP = 20
const STAGE_PADDING = 24
const EXCLUSION_EXPAND = 28
const CARD_MIN_W = 220
const CARD_MAX_W = 320

const TERMINAL_PHASES = new Set(['resolved', 'ambiguous', 'unavailable'])

const readMuted = () => { try { return localStorage.getItem(INTERFACE_SOUND_MUTED_KEY) === 'true' } catch { return false } }
const prefersReducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

function computeSphereExclusion(coreEl, stageEl) {
  if (!coreEl || !stageEl) return { left: 0, right: 0, top: 0, bottom: 0 }
  const cr = coreEl.getBoundingClientRect(); const sr = stageEl.getBoundingClientRect()
  const cx = cr.left + cr.width / 2 - sr.left; const cy = cr.top + cr.height / 2 - sr.top
  const radius = Math.max(cr.width, cr.height) / 2 + EXCLUSION_EXPAND
  return { left: cx - radius, right: cx + radius, top: cy - radius, bottom: cy + radius }
}

function placeCards(stageW, stageH, exclusion, cardIds) {
  const cardW = Math.max(CARD_MIN_W, Math.min(CARD_MAX_W, stageW - 2 * STAGE_PADDING))
  const leftSpace = exclusion.left - STAGE_PADDING
  const rightSpace = stageW - exclusion.right - STAGE_PADDING
  const belowSpace = stageH - exclusion.bottom - 2 * STAGE_PADDING - CARD_GAP

  if (leftSpace >= cardW + CARD_GAP && rightSpace >= cardW + CARD_GAP && cardIds.length === 3) {
    const measured = cardIds.map(id => {
      const el = document.querySelector(`[data-knowledge-card="${id}"]`)
      return { id, h: el ? el.getBoundingClientRect().height : 200 }
    })
    const actCard = measured.find(m => m.id === 'actions')
    const actH = actCard ? actCard.h : 140
    if (belowSpace >= actH + CARD_GAP) {
      const midY = exclusion.top + (exclusion.bottom - exclusion.top) / 2
      const positions = []
      const primH = measured.find(m => m.id === 'primary')?.h ?? 200
      const provH = measured.find(m => m.id === 'provenance')?.h ?? 200
      const primY = midY - primH / 2
      const provY = midY - provH / 2
      positions.push({ id: 'primary', x: STAGE_PADDING, y: Math.max(STAGE_PADDING, primY), className: 'k-card--left', width: cardW, height: primH })
      positions.push({ id: 'provenance', x: stageW - STAGE_PADDING - cardW, y: Math.max(STAGE_PADDING, provY), className: 'k-card--right', width: cardW, height: provH })
      positions.push({ id: 'actions', x: STAGE_PADDING + (stageW - 2 * STAGE_PADDING - cardW) / 2, y: exclusion.bottom + STAGE_PADDING + CARD_GAP, className: 'k-card--bottom-center', width: cardW, height: actH })
      return positions
    }
  }

  const columnW = Math.max(CARD_MIN_W, Math.min(CARD_MAX_W, stageW - 2 * STAGE_PADDING))
  return cardIds.map(id => ({ id, x: 0, y: 0, className: 'k-card--column', width: columnW, height: 0 }))
}

function KnowledgeCard({ cardId, className, label, onEject, style, children }) {
  return React.createElement('div', {
    className: `k-card ${className}`, style, role: 'group', 'aria-label': label, tabIndex: 0,
    'data-knowledge-card': cardId, 'data-gesture-target': `knowledge:${cardId}`,
    onKeyDown: (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.closest?.('button, a, input, textarea, select')) { e.preventDefault(); onEject(cardId) } }
  }, children)
}

export function KnowledgeProjection({ actions = {} }) {
  const [muted, setMuted] = React.useState(readMuted)
  const [result, setResult] = React.useState(null)
  const [stage, setStage] = React.useState(0)
  const [ejected, setEjected] = React.useState(() => new Set())
  const [status, setStatus] = React.useState('')
  const [proposal, setProposal] = React.useState(null)
  const [correction, setCorrection] = React.useState(null)
  const [activeConflictId, setActiveConflictId] = React.useState(null)
  const mutedRef = React.useRef(muted); mutedRef.current = muted
  const resultRef = React.useRef(null); resultRef.current = result
  const timers = React.useRef([])
  const emittedCues = React.useRef(new Set())
  const reducedMotion = prefersReducedMotion()
  const [placement, setPlacement] = React.useState([])
  const [exclusion, setExclusion] = React.useState({ left: 0, right: 0, top: 0, bottom: 0 })

  const cue = React.useCallback((resultId, name) => {
    if (mutedRef.current) return; const key = `${resultId}:${name}`
    if (emittedCues.current.has(key)) return; emittedCues.current.add(key)
    document.dispatchEvent(new CustomEvent(INTERFACE_SOUND_EVENT, { detail: { resultId, cue: name } }))
  }, [])

  const clearTimers = () => { for (const t of timers.current) clearTimeout(t); timers.current = [] }
  const dismissAll = React.useCallback(() => {
    const cur = resultRef.current; if (!cur) return; clearTimers(); cue(cur.resultId, 'dismiss')
    setResult(null); setStage(0); setEjected(new Set()); setStatus(''); setProposal(null); setCorrection(null)
    setActiveConflictId(null); setPlacement([]); setExclusion({ left: 0, right: 0, top: 0, bottom: 0 })
  }, [cue])

  const measure = React.useCallback(() => {
    const coreEl = document.querySelector('.core-wrap'); const stageEl = document.querySelector('.stage')
    if (!coreEl || !stageEl) return
    const sr = stageEl.getBoundingClientRect(); const excl = computeSphereExclusion(coreEl, stageEl)
    setExclusion(excl)

    const cur = resultRef.current; const terminal = cur && TERMINAL_PHASES.has(cur.phase)
    const provenance = cur?.provenance ?? []
    const permitted = cur?.actions ?? {}
    const hasOpen = Array.isArray(permitted.openSourceIds) && permitted.openSourceIds.length > 0
    const hasReorg = Array.isArray(permitted.reorganizeSourceIds) && permitted.reorganizeSourceIds.length > 0
    const hasCorrect = Array.isArray(permitted.correctConflictIds) && permitted.correctConflictIds.length > 0
    const hasActions = hasOpen || hasReorg || hasCorrect

    const cardIds = []
    if (terminal) { cardIds.push('primary'); if (provenance.length > 0) cardIds.push('provenance'); if (hasActions) cardIds.push('actions') }
    const positions = placeCards(sr.width, sr.height, excl, cardIds)
    const placements = positions.map((pos, i) => ({
      id: pos.id ?? cardIds[i], x: pos.x, y: pos.y, className: pos.className, width: pos.width,
      delayMs: reducedMotion ? 0 : i * STAGGER_MS
    }))
    setPlacement(placements)
  }, [reducedMotion])

  React.useEffect(() => { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure) }, [measure])
  React.useEffect(() => {
    const coreEl = document.querySelector('.core-wrap'); const stageEl = document.querySelector('.stage')
    const ro = new ResizeObserver(() => measure()); if (coreEl) ro.observe(coreEl); if (stageEl) ro.observe(stageEl)
    return () => ro.disconnect()
  }, [measure])

  React.useEffect(() => {
    const onResult = (event) => {
      const detail = event.detail
      if (!detail || typeof detail.resultId !== 'string' || !detail.resultId) return
      const cur = resultRef.current; if (cur && cur.resultId === detail.resultId && cur.phase === detail.phase) return
      clearTimers(); setEjected(new Set()); setStatus(''); setProposal(null); setCorrection(null); setActiveConflictId(null)
      if (detail.phase === 'retrieving') { setResult(detail); setStage(0); cue(detail.resultId, 'retrieve'); return }
      if (!TERMINAL_PHASES.has(detail.phase)) return
      setResult(detail); setStage(1); cue(detail.resultId, 'summon')
      if ((detail.provenance ?? []).length > 0) timers.current.push(setTimeout(() => { setStage((p) => Math.max(p, 2)); cue(detail.resultId, 'satellite') }, 120))
      const perm = detail.actions ?? {}
      if ((Array.isArray(perm.openSourceIds) && perm.openSourceIds.length > 0) || (Array.isArray(perm.reorganizeSourceIds) && perm.reorganizeSourceIds.length > 0) || (Array.isArray(perm.correctConflictIds) && perm.correctConflictIds.length > 0))
        timers.current.push(setTimeout(() => { setStage(3); cue(detail.resultId, 'lock') }, 240))
    }
    document.addEventListener(GROUNDED_RESULT_EVENT, onResult)
    return () => { document.removeEventListener(GROUNDED_RESULT_EVENT, onResult); clearTimers() }
  }, [cue])

  const terminal = result && TERMINAL_PHASES.has(result.phase)
  // Measure after state settles, then again after first render for measured heights
  React.useEffect(() => { if (terminal && stage >= 1) { const t = setTimeout(() => measure(), 0); return () => clearTimeout(t) } }, [result, stage, terminal, measure])
  React.useEffect(() => { if (placement.length > 0) { const t = setTimeout(() => measure(), 100); return () => clearTimeout(t) } }, [placement.length])

  React.useEffect(() => {
    const c = () => { if (!resultRef.current || document.querySelector('[data-jericho-active-approval="true"]')) return; dismissAll() }
    document.addEventListener(CANCEL_PENDING_EVENT, c); return () => document.removeEventListener(CANCEL_PENDING_EVENT, c)
  }, [dismissAll])
  React.useEffect(() => {
    const k = (e) => { if (e.key !== 'Escape' || !resultRef.current || document.querySelector('.sphere-command:not([hidden])') || document.querySelector('.modal-backdrop')) return; e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); dismissAll() }
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true)
  }, [dismissAll])
  React.useEffect(() => {
    const t = (e) => { const next = typeof e.detail?.muted === 'boolean' ? e.detail.muted : !mutedRef.current; try { localStorage.setItem(INTERFACE_SOUND_MUTED_KEY, next ? 'true' : 'false') } catch {}; setMuted(next) }
    document.addEventListener(INTERFACE_SOUND_TOGGLE_EVENT, t); return () => document.removeEventListener(INTERFACE_SOUND_TOGGLE_EVENT, t)
  }, [])
  const toggleMuted = () => { const next = !mutedRef.current; try { localStorage.setItem(INTERFACE_SOUND_MUTED_KEY, next ? 'true' : 'false') } catch {}; setMuted(next); document.dispatchEvent(new CustomEvent(INTERFACE_SOUND_TOGGLE_EVENT, { detail: { muted: next } })) }
  const eject = React.useCallback((id) => { const cur = resultRef.current; if (!cur) return; cue(cur.resultId, 'dismiss'); setEjected((p) => new Set(p).add(id)) }, [cue])

  const provenance = result?.provenance ?? []
  const permitted = result?.actions ?? {}
  const claims = result?.claims ?? []
  const conflicts = result?.conflicts ?? []
  const hasActions = (Array.isArray(permitted.openSourceIds) && permitted.openSourceIds.length > 0) || (Array.isArray(permitted.reorganizeSourceIds) && permitted.reorganizeSourceIds.length > 0) || (Array.isArray(permitted.correctConflictIds) && permitted.correctConflictIds.length > 0)

  React.useEffect(() => {
    if (!terminal) return
    const ids = ['primary', ...(provenance.length ? ['provenance'] : []), ...(hasActions ? ['actions'] : [])]
    if (ids.every((id) => ejected.has(id))) { clearTimers(); setResult(null); setStage(0); setEjected(new Set()); setStatus(''); setProposal(null); setCorrection(null); setActiveConflictId(null); setPlacement([]) }
  }, [terminal, ejected])

  const runAction = async (done, op) => { setStatus('WORKING'); try { await op(); setStatus(done) } catch (err) { setStatus(err instanceof Error ? err.message : 'ACTION FAILED') } }
  const resultId_ = result?.resultId ?? ''
  const identity = result?.fullName ?? result?.canonicalIdentity; const identityLabel = identity ?? (result?.subject ?? '')
  const relationship = result?.relationship; const guided = result?.guided
  const guidedChip = guided ? (result?.phase === 'resolved' ? 'PASS' : 'LIVE') : null
  const employment = result?.employment ?? []

  const openSourceIds = Array.isArray(permitted.openSourceIds) ? permitted.openSourceIds : []
  const reorganizeSourceIds = Array.isArray(permitted.reorganizeSourceIds) ? permitted.reorganizeSourceIds : []
  const correctConflictIds = Array.isArray(permitted.correctConflictIds) ? permitted.correctConflictIds : []

  // Build label-data maps for provenance and conflicts
  const provBySourceId = new Map(); for (const p of provenance) provBySourceId.set(p.sourceId, p)
  const confById = new Map(); for (const c of conflicts) confById.set(c.id, c)

  const open = (sourceId) => runAction('NOTE OPENED', () => actions.openMemory?.('', resultId_, sourceId) ?? Promise.reject(new Error('NO OPENER')))
  const reorganize = (sourceId) => runAction('REORGANIZATION PROPOSED', async () => {
    const resp = await actions.proposeNoteReorganization?.({ relativePath: '', title: '', resultId: resultId_, sourceId })
    if (resp?.proposal) setProposal(resp.proposal); return resp
  })
  const correct = (conflictId) => runAction('CORRECTION PREVIEW READY', async () => {
    setActiveConflictId(conflictId)
    try {
      const preview = await actions.correctIdentity?.(resultId_, conflictId)
      setCorrection(preview)
    } catch (err) { setActiveConflictId(null); throw err }
  })
  const confirmCorrection = () => {
    if (!activeConflictId) return
    runAction('CORRECTION CONFIRMED', () =>
      actions.confirmCorrection?.(correction, resultId_, activeConflictId) ?? Promise.reject(new Error('NOT AVAILABLE')))
  }
  const decideReorg = (outcome) => runAction(`REORGANIZATION ${outcome.toUpperCase()}`, () => {
    if (!actions.decideProposal || !proposal?.integrityHash) return Promise.reject(new Error('NOT AVAILABLE'))
    return actions.decideProposal({ proposalId: proposal.id, proposalHash: proposal.integrityHash, version: proposal.version, outcome, reason: `${outcome === 'approved' ? 'Approved' : 'Rejected'} grounded knowledge reorganization preview` })
  })

  const provenanceByRoot = new Map()
  for (const entry of provenance) { const rootId = entry.rootId ?? entry.relativePath?.split('/')[0] ?? 'unknown'; const g = provenanceByRoot.get(rootId) ?? []; g.push(entry); provenanceByRoot.set(rootId, g) }

  const placementById = new Map(placement.map((p) => [p.id, p]))
  const isColumn = placement.length > 0 && placement.every(p => p?.className?.includes?.('column'))
  const columnTop = isColumn ? Math.max(24, exclusion.bottom + CARD_GAP) : 0
  const stageEl = typeof document !== 'undefined' ? document.querySelector('.stage') : null
  const stageH = stageEl ? stageEl.getBoundingClientRect().height : 900
  const columnH = isColumn ? Math.max(200, stageH - columnTop) : 0

  const getPlacementStyle = (cardId) => {
    const p = placementById.get(cardId); if (!p) return {}
    const s = { '--kw': `${p.width}px`, '--kx': `${p.x}px`, '--ky': `${p.y}px`, '--kdelay': `${p.delayMs}ms` }
    if (reducedMotion) s.animation = 'k-fade 220ms ease-out both'; return s
  }

  const phaseStr = result?.phase ?? 'idle'; const routeStr = String(result?.route ?? '').toUpperCase()
  const allCards = []

  const actionLabel = (type, id) => {
    if (type === 'open' || type === 'reorg') {
      const p = provBySourceId.get(id)
      return p ? `${type === 'open' ? 'OPEN' : 'REORGANIZE'} ${p.title ?? p.relativePath ?? id}` : `${type === 'open' ? 'OPEN NOTE' : 'REORGANIZE'}`
    }
    const c = confById.get(id)
    return c ? `CORRECT ${c.claim?.slice(0, 40) ?? id}` : 'CORRECT'
  }

  if (terminal && stage >= 1 && !ejected.has('primary')) {
    const chips = []
    if (guided && result?.phase === 'resolved') chips.push(React.createElement(Chip, { tone: 'ok', key: 'pass' }, 'PASS'))
    if (relationship) chips.push(React.createElement(Chip, { key: 'rel' }, String(relationship).toUpperCase()))
    for (const org of employment) chips.push(React.createElement(Chip, { key: `org-${org}` }, String(org).toUpperCase()))

    allCards.push(React.createElement(KnowledgeCard, {
      cardId: 'primary', key: 'primary', className: `k-card--primary ${placementById.get('primary')?.className ?? ''}`,
      label: `Grounded ${result?.phase} card`, onEject: eject, style: getPlacementStyle('primary')
    },
      React.createElement(JerichoCard, {
        eyebrow: `GROUNDED · ${routeStr}`, source: 'OBSIDIAN',
        chip: guided ? guidedChip : (result?.phase === 'resolved' ? 'SOURCE-BACKED' : result?.phase === 'ambiguous' ? 'AMBIGUOUS' : 'UNAVAILABLE'),
        chipTone: result?.phase === 'unavailable' ? 'fault' : 'ok',
        big: result?.phase === 'unavailable' ? (identityLabel || 'NO EVIDENCE') : identityLabel,
        label: guided ? 'PERSON · GUIDED TEST' : 'PERSON · GROUNDED KNOWLEDGE',
        tone: result?.phase === 'unavailable' ? 'fault' : '',
        provenance: `INDEX REV ${result?.indexRevision ?? ''} · ${result?.retrievalCount ?? 0} RETRIEVAL`
      },
        chips.length > 0 ? React.createElement('div', { className: 'k-chips', key: 'chips' }, ...chips) : null,
        result?.confidence ? React.createElement('p', { className: 'k-evidence micro', key: 'conf' }, `CONFIDENCE · ${String(result.confidence).toUpperCase()}`) : null,
        claims.length > 0 ? React.createElement('div', { className: 'k-supported', key: 'claims' },
          React.createElement('p', { className: 'micro', style: { color: 'var(--cyan)', marginTop: 8 } }, 'CLAIMS'),
          ...claims.map((c) => React.createElement('p', { key: c.id, className: 'k-excerpt' }, c.text))
        ) : null,
        result?.phase === 'unavailable' ? React.createElement('p', { className: 'k-excerpt', key: 'unavail' }, (result?.summary) ?? 'The vault returned no canonical evidence for this subject.') : null
      )
    ))
  }

  if (terminal && stage >= 2 && provenance.length > 0 && !ejected.has('provenance')) {
    allCards.push(React.createElement(KnowledgeCard, {
      cardId: 'provenance', key: 'provenance', className: `k-card--provenance ${placementById.get('provenance')?.className ?? ''}`,
      label: 'Evidence card', onEject: eject, style: getPlacementStyle('provenance')
    },
      React.createElement(JerichoCard, {
        eyebrow: 'EVIDENCE', source: 'VAULT', chip: guided ? guidedChip : undefined, chipTone: 'ok',
        label: `${provenance.length} SOURCE · GROUPED BY ROOT${conflicts.length > 0 ? ' · CONFLICTS DETECTED' : ''}`,
        provenance: 'EVERY CLAIM IS PATH-BACKED'
      },
        ...[...provenanceByRoot].map(([rootId, entries]) =>
          React.createElement('div', { key: rootId, style: { marginBottom: 10 } },
            React.createElement('p', { className: 'micro', style: { color: 'var(--cyan)', borderBottom: '1px solid var(--stroke-dim)', paddingBottom: 3 } }, `ROOT · ${rootId} · ${String(entries[0]?.authority ?? '').toUpperCase()}`),
            React.createElement('ol', { className: 'k-provenance' },
              ...entries.map((e) => React.createElement('li', { key: e.sourceId }, React.createElement('code', null, e.relativePath), React.createElement('span', { className: 'micro' }, e.title)))
            )
          )
        ),
        conflicts.length > 0 ? React.createElement('div', { key: 'confs', style: { marginTop: 10 } },
          React.createElement('p', { className: 'micro', style: { color: 'var(--fault)' } }, 'CONFLICTS'),
          ...conflicts.map((c) => React.createElement('p', { key: c.id, className: 'k-excerpt', style: { color: 'var(--fault)' } }, `${c.claim} — ${c.reason}`))
        ) : null
      )
    ))
  }

  if (terminal && stage >= 3 && hasActions && !ejected.has('actions')) {
    allCards.push(React.createElement(KnowledgeCard, {
      cardId: 'actions', key: 'actions', className: `k-card--actions ${placementById.get('actions')?.className ?? ''}`,
      label: 'Actions plate', onEject: eject, style: getPlacementStyle('actions')
    },
      React.createElement(JerichoCard, {
        eyebrow: 'PERMITTED ACTIONS', source: 'JERICHO CORE', chip: guided ? guidedChip : undefined, chipTone: 'ok',
        label: 'REVIEW-GATED · NOTHING WRITTEN WITHOUT APPROVAL', provenance: 'AUTHENTICATED CORE CALLBACKS ONLY'
      },
        React.createElement('div', { className: 'k-actions' },
          ...openSourceIds.map((sid) => {
            const p = provBySourceId.get(sid)
            return React.createElement('button', { type: 'button', key: `open-${sid}`, 'data-gesture-target': `knowledge:open-note:${sid}`, 'aria-label': actionLabel('open', sid), onClick: () => { void open(sid) } }, 'OPEN NOTE')
          }),
          ...reorganizeSourceIds.map((sid) => {
            const p = provBySourceId.get(sid)
            return React.createElement('button', { type: 'button', key: `reorg-${sid}`, 'data-gesture-target': `knowledge:reorganize:${sid}`, 'aria-label': actionLabel('reorg', sid), onClick: () => { void reorganize(sid) } }, 'REORGANIZE')
          }),
          ...correctConflictIds.map((cid) => {
            const c = confById.get(cid)
            return React.createElement('button', { type: 'button', key: `corr-${cid}`, 'data-gesture-target': `knowledge:correct:${cid}`, 'aria-label': actionLabel('correct', cid), onClick: () => { void correct(cid) } }, 'CORRECT')
          }),
          correction ? React.createElement('button', { type: 'button', key: 'conf-corr', className: 'ok', 'data-gesture-target': 'knowledge:correct-confirm', onClick: () => { void confirmCorrection() } }, 'CONFIRM CORRECTION') : null
        ),
        proposal?.integrityHash ? React.createElement('div', { key: 'review', className: 'k-review', 'aria-label': 'Reorganization review' },
          React.createElement('p', null, proposal.summary ?? 'Review the exact reorganization proposal before recording a decision.'),
          React.createElement('div', { className: 'k-actions' },
            React.createElement('button', { type: 'button', className: 'ok', onClick: () => { void decideReorg('approved') } }, 'APPROVE REORGANIZATION'),
            React.createElement('button', { type: 'button', onClick: () => { void decideReorg('rejected') } }, 'REJECT REORGANIZATION')
          )
        ) : null,
        correction ? React.createElement('div', { key: 'corr-eff', style: { marginTop: 8 } },
          React.createElement('p', { className: 'micro', style: { color: 'var(--cyan)' } }, 'CORRECTION EFFECTS'),
          correction.disputedClaim ? React.createElement('p', { className: 'k-excerpt' }, 'Exclude: ' + correction.disputedClaim) : null,
          correction.coreEffects?.relationsToCreate?.[0]?.type ? React.createElement('p', { className: 'k-excerpt' }, `Relation: ${correction.coreEffects.relationsToCreate[0].type}`) : null
        ) : null,
        status ? React.createElement('p', { className: 'k-status micro', role: 'status', key: 'stat' }, status) : null
      )
    ))
  }

  const containerStyle = isColumn ? { position: 'absolute', left: 0, right: 0, top: `${columnTop}px`, height: `${columnH}px`, '--kmaxh': `${columnH}px`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', padding: '24px', overflowY: 'auto' } : undefined

  return React.createElement('div', {
    className: 'knowledge-projection', 'data-phase': phaseStr,
    'data-reduced-motion': reducedMotion ? 'true' : undefined,
    'aria-label': 'Grounded knowledge projection',
  },
    React.createElement('button', { type: 'button', className: 'k-sound-toggle micro', 'aria-pressed': muted, 'aria-label': 'Interface sound', 'data-gesture-target': 'knowledge:sound-toggle', onClick: toggleMuted, key: 'sound' }, muted ? 'SND MUTED' : 'SND ON'),
    allCards.length > 0 ? (isColumn ? React.createElement('div', { className: 'k-column-flow', key: 'flow', style: containerStyle }, ...allCards) : allCards) : null
  )
}
