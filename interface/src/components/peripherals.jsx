import React from 'react'
import { signals, tasks } from '../data'
import { StatusDot } from '../components'

function Clock() {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <time className="micro mononum" dateTime={now.toISOString()}>{now.toTimeString().slice(0, 8)} GST</time>
}

const VIEWS = ['CORE', 'MISSIONS', 'SIGNALS']

export function IdCluster({ activeView, onView }) {
  return <div className="cluster id-cluster">
    <div className="id-line">
      <span className="wordmark">JERICHO</span>
      <span className="micro"><StatusDot status="online" /> CONNECTED</span>
      <Clock />
    </div>
    <div className="view-tabs" role="tablist" aria-label="Projection">
      {VIEWS.map(view => (
        <button key={view} role="tab" aria-selected={activeView === view} onClick={() => onView(view)}>
          <span className="micro">{view}</span>
        </button>
      ))}
    </div>
  </div>
}

function ArcGauge({ label, value, max, display, unit, warn }) {
  const frac = Math.min(value / max, 1)
  const r = 16, c = 2 * Math.PI * r
  const arc = c * 0.78
  return <div className={`gauge ${warn ? 'warn' : ''}`}>
    <svg viewBox="0 0 44 44" role="img" aria-label={`${label} ${display}${unit}`}>
      <g transform="rotate(130 22 22)">
        <circle className="track" cx="22" cy="22" r={r} strokeDasharray={`${arc} ${c}`} />
        <circle className="val" cx="22" cy="22" r={r} strokeDasharray={`${arc * frac} ${c}`} />
      </g>
      <text className="gauge-num" x="22" y="26">{display}<tspan>{unit}</tspan></text>
    </svg>
    <span className="gauge-label">{label}</span>
  </div>
}

export function GaugeCluster() {
  return <div className="cluster gauge-cluster">
    <ArcGauge label="FLEET" value={4} max={6} display="04" unit="/06" />
    <ArcGauge label="QUEUE" value={71} max={100} display="71" unit="" warn />
    <ArcGauge label="LOAD" value={67} max={100} display="67" unit="%" />
    <ArcGauge label="UPTIME" value={54} max={72} display="54" unit="H" />
  </div>
}

export function MissionsCluster({ onSummon }) {
  return <div className="cluster missions-cluster">
    <button className="cluster-head" onClick={onSummon} aria-label="Summon mission field">
      <span className="micro">MISSIONS</span><span className="micro cy mononum">05</span>
    </button>
    <div className="cluster-rows">
      {tasks.map(task => (
        <div key={task.id} className={`micro-row ${task.priority} ${task.status.toLowerCase()}`}>
          <span className="code">{task.id}</span>
          <span className="title">{task.title}</span>
          <span className="state">{task.status}</span>
        </div>
      ))}
    </div>
  </div>
}

export function SignalsCluster({ onSummon }) {
  return <div className="cluster signals-cluster">
    <button className="cluster-head" onClick={onSummon} aria-label="Summon signal bus">
      <span className="micro">SIGNALS</span><span className="micro cy">LIVE</span>
    </button>
    <div className="cluster-rows">
      {signals.map(signal => (
        <div key={signal.time} className={`micro-row ${signal.level}`}>
          <time>{signal.time}</time>
          <span className="src">{signal.source}</span>
          <span className="title">{signal.message}</span>
        </div>
      ))}
    </div>
  </div>
}

export function MissionsProjection({ onReturn }) {
  return <section className="projection" aria-label="Mission projection">
    <header>
      <h2>MISSION FIELD</h2><span className="micro">05 ACTIVE · 03 BLOCKED</span>
      <button className="return micro" onClick={onReturn}>RETURN</button>
    </header>
    {tasks.map(task => (
      <div key={task.id} className={`proj-row ${task.priority} ${task.status.toLowerCase()}`}>
        <span className="code">{task.id}</span>
        <span className="title"><strong>{task.title}</strong><small>{task.meta}</small></span>
        <span className="state">{task.status} · {task.agent}</span>
        <span className="age">{task.age}</span>
      </div>
    ))}
  </section>
}

export function SignalsProjection({ onReturn }) {
  return <section className="projection" aria-label="Signal projection">
    <header>
      <h2>BUS SPECTRUM</h2><span className="micro">LIVE · 05 EVENT</span>
      <button className="return micro" onClick={onReturn}>RETURN</button>
    </header>
    {signals.map(signal => (
      <div key={signal.time} className={`proj-row signal ${signal.level}`}>
        <time>{signal.time}</time>
        <span className="src">{signal.source}</span>
        <p>{signal.message}</p>
      </div>
    ))}
  </section>
}
