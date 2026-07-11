import React from 'react'
import { signals, tasks } from '../data'
import { StatusDot } from '../components'
import { JerichoCard } from './JerichoCard'
import { SegBar } from './charts'

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

// Radial slots around the sphere — cards pop OUT from the center, never over it.
// Offsets in vmin from screen center; left flank = blocked column, right = flow.
const SLOTS = [
  { x: -46, y: -20 }, // left top
  { x: -52, y: 6 },   // left mid
  { x: -42, y: 30 },  // left low
  { x: 44, y: -18 },  // right top
  { x: 48, y: 12 },   // right mid
]

const AGE_UNITS = { H: 1, D: 24 }
function ageHours(age) {
  let hours = 0
  for (const [, n, u] of age.matchAll(/(\d+)\s*([DH])/g)) hours += Number(n) * AGE_UNITS[u]
  return hours
}

const STATUS_RANK = { BLOCKED: 0, READY: 1, NEW: 2 }

export function MissionsProjection() {
  const ordered = [...tasks].sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3))
  return <div className="projection-radial" aria-label="Mission projection">
    {ordered.map((task, i) => {
      const blocked = task.status === 'BLOCKED'
      const slot = SLOTS[i % SLOTS.length]
      return <JerichoCard
        key={task.id}
        index={i}
        className="radial-card"
        style={{ '--tx': `${slot.x}vmin`, '--ty': `${slot.y}vmin` }}
        tone={blocked ? 'fault' : ''}
        eyebrow={task.id}
        source={task.agent}
        chip={task.status}
        chipTone={blocked ? 'fault' : task.status === 'READY' ? 'ok' : 'dim'}
        provenance={`${task.meta.toUpperCase()} · AGE ${task.age}`}
      >
        <p className="jc-title">{task.title}</p>
        <SegBar value={Math.min(ageHours(task.age), 96)} max={96} units={12} mode="circle" width={110} height={7} fault={blocked} />
      </JerichoCard>
    })}
  </div>
}

export function SignalsProjection() {
  return <div className="projection-radial" aria-label="Signal projection">
    {signals.map((signal, i) => {
      const slot = SLOTS[i % SLOTS.length]
      return <JerichoCard
        key={signal.time}
        index={i}
        className="radial-card"
        style={{ '--tx': `${slot.x}vmin`, '--ty': `${slot.y}vmin` }}
        tone={signal.level === 'critical' ? 'fault' : ''}
        eyebrow={signal.source}
        chip={signal.level.toUpperCase()}
        chipTone={signal.level === 'critical' ? 'fault' : signal.level === 'warn' ? 'dim' : signal.level === 'ok' ? 'ok' : ''}
        provenance={`BUS EVENT · ${signal.time} GST`}
      >
        <p className="jc-title">{signal.message}</p>
      </JerichoCard>
    })}
  </div>
}
