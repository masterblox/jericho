import React from 'react'
import { agents, signals, system, tasks } from '../data'
import { StatusDot } from '../components'
import { JerichoCard } from './JerichoCard'
import { Sparkbars, SegBar } from './charts'

function Clock() {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <time className="micro mononum" dateTime={now.toISOString()}>{now.toTimeString().slice(0, 8)} GST</time>
}

const VIEWS = ['CORE', 'MISSIONS', 'SIGNALS']

export function IdCluster({ activeView, onView, coreState = 'idle' }) {
  return <div className="cluster id-cluster">
    <div className="id-line">
      <span className="wordmark">JERICHO</span>
      <span className="micro"><StatusDot status="online" /> CONNECTED</span>
      <span className="micro">CORE <b className={coreState === 'alert' ? 'fault' : 'cy'}>{coreState === 'idle' ? 'STABLE' : coreState.toUpperCase()}</b></span>
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
  const online = agents.filter(a => a.status === 'online').length
  const avgLoad = Math.round(agents.reduce((sum, a) => sum + a.load, 0) / agents.length)
  const blocked = tasks.filter(t => t.status === 'BLOCKED').length
  const pad = n => String(n).padStart(2, '0')
  return <div className="cluster gauge-cluster">
    <ArcGauge label="FLEET" value={online} max={agents.length} display={pad(online)} unit={`/${pad(agents.length)}`} warn={online < agents.length - 1} />
    <ArcGauge label="QUEUE" value={system.deferred} max={100} display={String(system.deferred)} unit="" warn={blocked > 0} />
    <ArcGauge label="LOAD" value={avgLoad} max={100} display={String(avgLoad)} unit="%" />
    <ArcGauge label="UPTIME" value={system.uptimeHours} max={system.uptimeMax} display={String(system.uptimeHours)} unit="H" />
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

const AGE_UNITS = { H: 1, D: 24 }
function ageHours(age) {
  let hours = 0
  for (const [, n, u] of age.matchAll(/(\d+)\s*([DH])/g)) hours += Number(n) * AGE_UNITS[u]
  return hours
}

export function MissionsProjection({ onReturn }) {
  const blocked = tasks.filter(t => t.status === 'BLOCKED').length
  return <section className="projection" aria-label="Mission projection">
    <header>
      <h2>MISSION FIELD</h2>
      <span className="micro">{String(tasks.length).padStart(2, '0')} ACTIVE · {String(blocked).padStart(2, '0')} BLOCKED</span>
      <span className="trend micro">QUEUE <Sparkbars series={system.queueTrend} width={84} height={16} /></span>
      <button className="return micro" onClick={onReturn}>RETURN</button>
    </header>
    <div className="card-grid">
      {tasks.map((task, i) => {
        const blockedTask = task.status === 'BLOCKED'
        return <JerichoCard
          key={task.id}
          index={i}
          tone={blockedTask ? 'fault' : ''}
          eyebrow={task.id}
          source={task.agent}
          chip={task.status}
          chipTone={blockedTask ? 'fault' : task.status === 'READY' ? 'ok' : 'dim'}
          provenance={`${task.meta.toUpperCase()} · AGE ${task.age}`}
        >
          <p className="jc-title">{task.title}</p>
          <SegBar value={Math.min(ageHours(task.age), 96)} max={96} units={12} mode="circle" width={110} height={7} fault={blockedTask} />
        </JerichoCard>
      })}
    </div>
  </section>
}

export function SignalsProjection({ onReturn }) {
  return <section className="projection" aria-label="Signal projection">
    <header>
      <h2>BUS SPECTRUM</h2><span className="micro">LIVE · {String(signals.length).padStart(2, '0')} EVENT</span>
      <button className="return micro" onClick={onReturn}>RETURN</button>
    </header>
    <div className="card-grid">
      {signals.map((signal, i) => (
        <JerichoCard
          key={signal.time}
          index={i}
          tone={signal.level === 'critical' ? 'fault' : ''}
          eyebrow={signal.source}
          chip={signal.level.toUpperCase()}
          chipTone={signal.level === 'critical' ? 'fault' : signal.level === 'warn' ? 'dim' : signal.level === 'ok' ? 'ok' : ''}
          provenance={`BUS EVENT · ${signal.time} GST`}
        >
          <p className="jc-title">{signal.message}</p>
        </JerichoCard>
      ))}
    </div>
  </section>
}
