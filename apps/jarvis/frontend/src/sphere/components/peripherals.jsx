import React from 'react'
import { StatusDot } from '../components'
import { JerichoCard } from './JerichoCard'

function Clock() {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <time className="micro mononum" dateTime={now.toISOString()}>{now.toTimeString().slice(0, 8)} GST</time>
}

const VIEWS = ['CORE', 'AGENTS', 'TASKS', 'BRAIN']

export function FleetLifecycle({ stages }) {
  return <ol className="fleet-lifecycle" aria-label="Fleet delivery lifecycle">
    {stages.map((stage, index) => <li key={stage.label} className={stage.active ? 'active' : ''}>
      <span>{String(index + 1).padStart(2, '0')}</span>
      <strong>{stage.label}</strong>
      <b>{String(stage.count).padStart(2, '0')}</b>
    </li>)}
  </ol>
}

export function IdCluster({ activeView, onView, coreState = 'idle', connected = false }) {
  return <div className="cluster id-cluster">
    <div className="id-line">
      <span className="wordmark">JERICHO</span>
      <span className="micro"><StatusDot status={connected ? 'online' : 'degraded'} /> {connected ? 'CONNECTED' : 'CORE WAIT'}</span>
      <span className="micro">CORE <b className={coreState === 'alert' ? 'fault' : 'cy'}>{coreState === 'idle' ? 'STABLE' : coreState.toUpperCase()}</b></span>
      <Clock />
    </div>
    <div className="view-tabs" role="tablist" aria-label="Projection">
      {VIEWS.map(view => (
        <button key={view} role="tab" data-gesture-target={`view:${view.toLowerCase()}`} aria-selected={activeView === view} onClick={() => onView(view)}>
          <span className="micro">{view}</span>
        </button>
      ))}
    </div>
  </div>
}

// AGENTS — the live Hermes fleet from the Paperclip board, via the bridge.
// Fail-closed: an offline board renders as an explicit state, never a roster.
const AGENT_SLOTS = [
  { x: -46, y: -22 }, { x: -54, y: 2 }, { x: -44, y: 26 },
  { x: 44, y: -22 }, { x: 54, y: 2 }, { x: 44, y: 26 },
  { x: -18, y: -34 }, { x: 18, y: -34 }, { x: 0, y: 38 },
]

function heartbeatLabel(iso) {
  if (!iso) return 'NO HEARTBEAT'
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 3_600_000))
  if (hours < 1) return 'HEARTBEAT <1H'
  return hours >= 24 ? `HEARTBEAT ${Math.floor(hours / 24)}D AGO` : `HEARTBEAT ${hours}H AGO`
}

export function AgentsProjection({ fleet }) {
  if (!fleet?.available) {
    return <div className="projection-radial" aria-label="Agent projection">
      <JerichoCard index={0} className="radial-card" style={{ '--tx': '0vmin', '--ty': '-30vmin' }}
        tone="fault" eyebrow="HERMES FLEET" chip="OFFLINE" chipTone="fault"
        provenance="PAPERCLIP BOARD UNREACHABLE · READ-ONLY PROJECTION">
        <p className="jc-title">Fleet board unavailable — no roster is shown rather than a stale one.</p>
      </JerichoCard>
    </div>
  }
  return <div className="projection-radial" aria-label="Agent projection">
    {fleet.agents.slice(0, AGENT_SLOTS.length).map((agent, i) => {
      const slot = AGENT_SLOTS[i % AGENT_SLOTS.length]
      const faulted = agent.status === 'error' || agent.status === 'stale'
      return <JerichoCard
        key={agent.id}
        index={i}
        className="radial-card radial-card--compact"
        data-gesture-target={`agent:${agent.id}`}
        style={{ '--tx': `${slot.x}vmin`, '--ty': `${slot.y}vmin` }}
        tone={faulted ? 'fault' : ''}
        eyebrow={agent.role.toUpperCase()}
        chip={agent.status.toUpperCase()}
        chipTone={faulted ? 'fault' : agent.status === 'paused' ? 'dim' : 'ok'}
        provenance={heartbeatLabel(agent.lastHeartbeatAt)}
      >
        <p className="jc-title">{agent.name}</p>
      </JerichoCard>
    })}
  </div>
}

// TASKS — kanban over live truth: Paperclip issues + Jericho Core missions.
const KANBAN_COLUMNS = ['QUEUED', 'ACTIVE', 'REVIEW', 'DONE']
const ISSUE_COLUMN = {
  queued: 'QUEUED', todo: 'QUEUED', backlog: 'QUEUED',
  in_progress: 'ACTIVE', active: 'ACTIVE', doing: 'ACTIVE',
  in_review: 'REVIEW', review: 'REVIEW',
  done: 'DONE', closed: 'DONE', cancelled: 'DONE',
}
const MISSION_STAGE_COLUMN = {
  plan: 'QUEUED', approve: 'REVIEW', execute: 'ACTIVE', present: 'REVIEW', review: 'REVIEW',
}
const CARDS_PER_COLUMN = 5

export function TasksProjection({ tasks, fleet }) {
  const columns = new Map(KANBAN_COLUMNS.map(name => [name, []]))
  for (const task of tasks) {
    const column = task.done ? 'DONE' : (MISSION_STAGE_COLUMN[task.stage] ?? 'QUEUED')
    columns.get(column).push({
      key: `mission:${task.id}`, source: 'JERICHO', title: task.title,
      label: task.agent, fault: task.status === 'BLOCKED', approval: task.approval,
    })
  }
  for (const issue of (fleet?.available ? fleet.issues : [])) {
    const column = ISSUE_COLUMN[issue.status] ?? 'QUEUED'
    columns.get(column).push({
      key: `issue:${issue.id}`, source: issue.identifier, title: issue.title,
      label: issue.priority ? issue.priority.toUpperCase() : '', fault: false,
    })
  }
  const approvalCards = [...columns.values()].flat().filter(card => card.approval)
  const [selectedApprovalKey, setSelectedApprovalKey] = React.useState(null)
  const activeApprovalKey = approvalCards.length === 1
    ? approvalCards[0].key
    : approvalCards.some(card => card.key === selectedApprovalKey) ? selectedApprovalKey : null

  return <div className="projection-kanban" aria-label="Task projection">
    {KANBAN_COLUMNS.map(name => {
      const cards = columns.get(name)
      return <section key={name} className="kanban-column">
        <header className="micro">{name} <b className="mononum">{cards.length}</b></header>
        <ol>
          {cards.slice(0, CARDS_PER_COLUMN).map(card => (
            <li
              key={card.key}
              className={`kanban-card ${card.fault ? 'fault' : ''}`}
              data-gesture-target={card.key}
              data-jericho-active-approval={card.approval && card.key === activeApprovalKey ? 'true' : undefined}
              data-jericho-approval-mission-id={card.approval?.missionId}
              data-jericho-approval-plan-hash={card.approval?.planHash}
              data-jericho-approval-version={card.approval?.version}
              tabIndex={card.approval ? 0 : undefined}
              aria-selected={card.approval ? card.key === activeApprovalKey : undefined}
              onClick={card.approval ? () => setSelectedApprovalKey(card.key) : undefined}
              onFocus={card.approval ? () => setSelectedApprovalKey(card.key) : undefined}
            >
              <span className="micro">{card.source}{card.label ? ` · ${card.label}` : ''}</span>
              <p>{card.title}</p>
            </li>
          ))}
          {cards.length > CARDS_PER_COLUMN && (
            <li className="kanban-more micro">+{cards.length - CARDS_PER_COLUMN} MORE</li>
          )}
        </ol>
      </section>
    })}
    {!fleet?.available && <p className="kanban-offline micro">PAPERCLIP OFFLINE · SHOWING CORE MISSIONS ONLY</p>}
  </div>
}

// BRAIN — Obsidian vault search (BM25 RAG via the bridge) + Nucleus truth.
export function BrainProjection({ nucleus, onSearch }) {
  const [query, setQuery] = React.useState('')
  const [result, setResult] = React.useState(null)
  const [searching, setSearching] = React.useState(false)

  const submit = async event => {
    event.preventDefault()
    if (!onSearch || !query.trim() || searching) return
    setSearching(true)
    try { setResult(await onSearch(query)) }
    catch { setResult({ available: false, count: 0, results: [] }) }
    finally { setSearching(false) }
  }

  return <div className="projection-brain" aria-label="Brain projection">
    <form className="brain-search" onSubmit={submit}>
      <span className="micro cy">VAULT QUERY</span>
      <input
        type="search"
        value={query}
        placeholder="Search the Obsidian brain…"
        onChange={event => setQuery(event.target.value)}
        aria-label="Vault search query"
      />
      <button type="submit" data-gesture-target="brain:search" disabled={searching}>
        {searching ? 'SEARCHING' : 'SEARCH'}
      </button>
    </form>
    <p className="micro brain-nucleus">
      NUCLEUS · {nucleus?.nodes ?? 0} ENTITIES · {nucleus?.edges ?? 0} RELATIONS
    </p>
    {result && !result.available && (
      <p className="micro brain-offline">VAULT SEARCH OFFLINE · GATEWAY NOT CONFIGURED OR UNREACHABLE</p>
    )}
    {result?.available && (
      <ol className="brain-results">
        {result.results.length === 0 && <li className="micro">NO MATCHES</li>}
        {result.results.map(hit => (
          <li key={hit.path} data-gesture-target={`brain:${hit.path}`}>
            <span className="micro cy">{hit.title}</span>
            <p>{hit.excerpt}</p>
            <span className="micro">{hit.path}</span>
          </li>
        ))}
      </ol>
    )}
  </div>
}
