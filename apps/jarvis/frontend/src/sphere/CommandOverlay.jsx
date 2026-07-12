import React from 'react'
import { IsabellaGuidedTest } from './IsabellaGuidedTest'

const MODES = [
  ['directive', 'NEW DIRECTIVE'],
  ['memory', 'SEARCH MEMORY'],
  ['approvals', 'PENDING APPROVALS'],
  ['missions', 'ACTIVE MISSION'],
  ['outcomes', 'RECENT OUTCOME'],
]

export function CommandOverlay({ open, onClose, liveData, actions, guidedTestSession = 0, guidedTestActive = false }) {
  const [mode, setMode] = React.useState('home')
  const [query, setQuery] = React.useState('')
  const [directive, setDirective] = React.useState('')
  const [memory, setMemory] = React.useState({ status: 'idle', results: [], error: '' })
  const [selectedMemory, setSelectedMemory] = React.useState(null)
  const [selectedMissionId, setSelectedMissionId] = React.useState(null)
  const [message, setMessage] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    const onKey = event => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  React.useEffect(() => {
    if (guidedTestActive && guidedTestSession > 0) setMode('guided')
    else if (!guidedTestActive) setMode(current => current === 'guided' ? 'home' : current)
  }, [guidedTestActive, guidedTestSession])

  const selectedMission = liveData.missions.find(item => item.id === selectedMissionId)
    ?? liveData.missions.find(item => item.active)
    ?? liveData.missions[0]
  const approval = selectedMission?.approval

  const run = async (operation, success) => {
    setMessage('WORKING')
    try {
      await operation()
      setMessage(success)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ACTION FAILED')
    }
  }

  const search = async event => {
    event.preventDefault()
    if (!query.trim()) return
    setMemory({ status: 'loading', results: [], error: '' })
    try {
      const response = await actions.searchMemory(query.trim())
      setMemory({ status: 'ready', results: response.results, error: '' })
    } catch (error) {
      setMemory({ status: 'error', results: [], error: error instanceof Error ? error.message : 'SEARCH FAILED' })
    }
  }

  return <section className="sphere-command" role="dialog" aria-modal={open ? 'true' : undefined} aria-label="Jericho command overlay" hidden={!open}>
    <header>
      <span className="micro">SPHERE COMMAND / BOUNDED OPERATOR ACTIONS</span>
      <strong>{mode === 'home' ? 'COMMAND' : mode === 'guided' ? 'GUIDED TEST · ISABELLA' : mode.toUpperCase()}</strong>
      <button type="button" data-gesture-target="command:close" onClick={onClose} aria-label="Close command overlay">×</button>
    </header>
    <nav aria-label="Command modes">
      {MODES.map(([id, label]) => <button
        key={id}
        type="button"
        data-gesture-target={`command:${id}`}
        aria-pressed={mode === id}
        onClick={() => { setMode(id); setSelectedMemory(null) }}
      ><span>{String(MODES.findIndex(item => item[0] === id) + 1).padStart(2, '0')}</span>{label}</button>)}
    </nav>
    <div className="sphere-command__body">
      {mode === 'home' && <div className="sphere-command__intro">
        <p>Choose one bounded action. No send, deploy, destructive mutation, or unapproved execution is available here.</p>
        <dl><div><dt>MISSIONS</dt><dd>{liveData.missions.length}</dd></div><div><dt>APPROVALS</dt><dd>{liveData.approvals.length}</dd></div><div><dt>OUTCOMES</dt><dd>{liveData.outcomes.length}</dd></div></dl>
      </div>}
      {mode === 'guided' && <IsabellaGuidedTest session={guidedTestSession} active={guidedTestActive} actions={actions} />}
      {mode === 'directive' && <form className="sphere-command__form" onSubmit={event => {
        event.preventDefault()
        if (!directive.trim()) return
        actions.dispatchDirective(directive.trim())
        setDirective('')
        onClose()
      }}>
        <label htmlFor="sphere-directive">IMMUTABLE CORE CAPTURE</label>
        <textarea id="sphere-directive" value={directive} onChange={event => setDirective(event.target.value)} placeholder="Describe the result you want…" />
        <button type="submit" data-gesture-target="command:capture" disabled={!directive.trim()}>REVIEW DIRECTIVE</button>
      </form>}
      {mode === 'memory' && <div className="sphere-memory">
        <form className="sphere-command__form" onSubmit={search}>
          <label htmlFor="sphere-memory-query">PRIVATE OBSIDIAN SEARCH</label>
          <div><input id="sphere-memory-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Person, project, decision…" /><button type="submit" data-gesture-target="command:memory-search" disabled={!query.trim() || memory.status === 'loading'}>{memory.status === 'loading' ? 'SEARCHING' : 'SEARCH'}</button></div>
        </form>
        {memory.error && <p className="sphere-command__error">{memory.error}</p>}
        <ol>{memory.results.map(result => <li key={result.path}>
          <button type="button" data-gesture-target={`memory:${result.path}`} onClick={() => setSelectedMemory(result)}><strong>{result.title}</strong><span>REL {result.score.toFixed(2)}</span><code>{result.path}</code></button>
        </li>)}</ol>
        {selectedMemory && <article className="sphere-memory__preview">
          <header><strong>{selectedMemory.title}</strong><code>{selectedMemory.path}</code></header>
          <p>{selectedMemory.excerpt}</p>
          <button type="button" data-gesture-target="memory:open" onClick={() => void run(
            () => actions.openMemory(selectedMemory.path), 'OPENED IN OBSIDIAN',
          )}>OPEN IN OBSIDIAN</button>
        </article>}
      </div>}
      {(mode === 'missions' || mode === 'approvals') && <div className="sphere-missions">
        <ol>{liveData.missions.filter(item => mode !== 'approvals' || item.approval).map(item => <li key={item.id}>
          <button type="button" data-gesture-target={`command:mission:${item.id}`} aria-pressed={selectedMission?.id === item.id} onClick={() => setSelectedMissionId(item.id)}><strong>{item.title}</strong><span>{item.stage} · {item.status}</span></button>
        </li>)}</ol>
        {selectedMission && <article className="sphere-mission-detail">
          <header><span>{selectedMission.stage}</span><strong>{selectedMission.title}</strong><b>{selectedMission.status}</b></header>
          <p>{selectedMission.objective}</p>
          <dl><div><dt>AGENTS</dt><dd>{selectedMission.agents || 'JERICHO'}</dd></div><div><dt>COST</dt><dd>${(selectedMission.actualCostMicroUsd / 1_000_000).toFixed(4)} / ${(selectedMission.maxCostMicroUsd / 1_000_000).toFixed(4)}</dd></div><div><dt>EVIDENCE</dt><dd>{selectedMission.evidenceCount}</dd></div><div><dt>RECEIPTS</dt><dd>{selectedMission.receiptCount}</dd></div></dl>
          {approval && <code>V{approval.version} · {approval.planHash}</code>}
          <footer>
            {approval && <><button type="button" className="ok" data-gesture-target={`command:approve:${selectedMission.id}`} onClick={() => void run(() => actions.decide(approval, 'approved'), 'PLAN APPROVED')}>APPROVE EXACT PLAN</button><button type="button" data-gesture-target={`command:reject:${selectedMission.id}`} onClick={() => void run(() => actions.decide(approval, 'rejected'), 'PLAN REJECTED')}>REJECT</button></>}
            {selectedMission.cancellable && <button type="button" data-gesture-target={`command:cancel:${selectedMission.id}`} onClick={() => void run(() => actions.cancel(selectedMission), 'CANCELLATION RECORDED')}>CANCEL MISSION</button>}
            {selectedMission.retainable && <button type="button" className="ok" data-gesture-target={`command:retain:${selectedMission.id}`} onClick={() => void run(() => actions.retain(selectedMission.id), 'RETAINED IN OBSIDIAN')}>RETAIN VERIFIED MISSION</button>}
          </footer>
        </article>}
      </div>}
      {mode === 'outcomes' && <div className="sphere-outcomes">
        {liveData.outcomes.length ? liveData.outcomes.map(item => <article key={item.id}><strong>{item.verified ? 'VERIFIED' : 'PENDING'}</strong><span>{item.missionTaskId}</span><code>{item.receiptCount} RECEIPTS</code></article>) : <p>NO VERIFIED OUTCOMES</p>}
        {liveData.paperclip.map(item => <article key={item.id}><strong>PAPERCLIP · {item.status}</strong><span>{item.issueId ?? item.error ?? 'NOT RECONCILED'}</span><code>{item.verifiedByCore ? 'CORE VERIFIED' : 'QUEUE OBSERVATION ONLY'}</code></article>)}
      </div>}
    </div>
    {message && <footer className="sphere-command__status" role="status">{message}</footer>}
  </section>
}
