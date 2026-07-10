import React from 'react'
import { agents, navItems, signals, tasks } from './data'

export function Mark() {
  return <div className="mark" aria-label="Jericho"><span>J</span><i /></div>
}

export function StatusDot({ status }) {
  return <span className={`status-dot ${status}`} aria-label={status} />
}

export function Navigation({ active, onChange }) {
  return <nav className="nav" aria-label="Primary">
    {navItems.map(item => (
      <button key={item} className={active === item ? 'active' : ''} onClick={() => onChange(item)}>
        <span className="nav-index">0{navItems.indexOf(item) + 1}</span>{item}
      </button>
    ))}
  </nav>
}

export function FleetList({ selected, onSelect }) {
  return <div className="fleet-list">
    {agents.map(agent => (
      <button key={agent.id} className={selected === agent.id ? 'selected' : ''} onClick={() => onSelect(agent.id)}>
        <StatusDot status={agent.status} />
        <span className="agent-name">{agent.id}</span>
        <span className="agent-role">{agent.role}</span>
        <span className="agent-load">{agent.load}%</span>
      </button>
    ))}
  </div>
}

export function TaskRows({ compact = false }) {
  return <div className={`task-rows ${compact ? 'compact' : ''}`}>
    {tasks.map(task => (
      <div className={`task-row ${task.priority}`} key={task.id}>
        <span className="task-code">{task.id}</span>
        <span className="task-copy"><strong>{task.title}</strong><small>{task.meta}</small></span>
        <span className="task-agent">{task.agent}</span>
        <span className={`task-status ${task.status.toLowerCase()}`}>{task.status}</span>
        <span className="task-age">{task.age}</span>
      </div>
    ))}
  </div>
}

export function SignalFeed() {
  return <div className="signal-feed">
    {signals.map((signal, index) => (
      <div className={`signal-line ${signal.level}`} key={`${signal.time}-${index}`}>
        <time>{signal.time}</time><span>{signal.source}</span><p>{signal.message}</p>
      </div>
    ))}
  </div>
}

export function CommandBar({ onPreview }) {
  const [value, setValue] = React.useState('')
  const submit = event => {
    event.preventDefault()
    if (value.trim()) onPreview(value.trim())
  }
  return <form className="command-bar" onSubmit={submit}>
    <span className="prompt">›</span>
    <label className="sr-only" htmlFor="directive">Issue a directive</label>
    <input id="directive" value={value} onChange={event => setValue(event.target.value)} placeholder="Issue a directive to the fleet…" />
    <span className="shortcut">⌘ ↵</span>
    <button type="submit">DECOMPOSE</button>
  </form>
}

export function DispatchModal({ directive, onClose, onDispatch }) {
  if (!directive) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-title">
      <header><span>DIRECTIVE DECOMPOSITION / HUMAN GATE</span><button onClick={onClose} aria-label="Close">×</button></header>
      <div className="modal-body">
        <p className="eyebrow">DIRECTIVE</p>
        <h2 id="dispatch-title">{directive}</h2>
        <div className="dispatch-route">
          <div><span>01</span><strong>ANALYZE</strong><small>JERICHO / 4 SEC</small></div>
          <i>→</i><div><span>02</span><strong>ASSIGN</strong><small>DEV + ANALYST</small></div>
          <i>→</i><div><span>03</span><strong>VERIFY</strong><small>HUMAN GATE</small></div>
        </div>
        <div className="risk-note"><span>LOW RISK</span> NO EXTERNAL MESSAGES / NO DESTRUCTIVE ACTIONS</div>
      </div>
      <footer><button className="ghost" onClick={onClose}>CANCEL</button><button className="confirm" onClick={onDispatch}>CONFIRM DISPATCH</button></footer>
    </section>
  </div>
}

export function Toast({ visible }) {
  return <div className={`toast ${visible ? 'visible' : ''}`} role="status"><StatusDot status="online" /> DIRECTIVE DISPATCHED / TRACKING ACTIVE</div>
}

export function Metrics() {
  return <div className="metrics">
    <div><span>FLEET</span><strong>04<span>/06</span></strong><small>OPERATIONAL</small></div>
    <div><span>QUEUE</span><strong>71</strong><small>DEFERRED</small></div>
    <div><span>LOAD</span><strong>67<span>%</span></strong><small>NOMINAL</small></div>
    <div><span>UPTIME</span><strong>54<span>H</span></strong><small>GATEWAY</small></div>
  </div>
}
