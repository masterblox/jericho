import React from 'react'
import { agents, signals, tasks } from '../data'
import { CommandBar, StatusDot } from '../components'
import { ParticleField } from '../ParticleField'

const positions = {
  DEV: [35, 32], PA: [39, 61], IRIS: [65, 32], ANALYST: [51, 46], RESEARCH: [65, 61], INTEL: [82, 47],
}

function CoreModel({ selectedAgent }) {
  const agent = agents.find(item => item.id === selectedAgent) || agents[0]
  return <>
    {/* Reactor core — diagnostic wireframe, not decorative ring */}
    <button className="reactor-target" aria-label="Inspect Jericho fleet core">
      <span /><i /><b /><u /><em />
    </button>

    {/* Agent nodes with calibration traces */}
    {agents.map(item => {
      const [x, y] = positions[item.id]
      return <button key={item.id} aria-label={item.id + ' ' + item.role}
        className={'scene-hotspot ' + item.status + (selectedAgent === item.id ? ' selected' : '')}
        style={{ '--x': x + '%', '--y': y + '%' }}>
        <i /><span>{item.id}</span>
      </button>
    })}

    {/* Telemetry slab — anchored left, connected to its agent */}
    <aside className={'telemetry-slab ' + agent.status}>
      <header><StatusDot status={agent.status} /><span>NODE / {agent.id}</span><b>{agent.status}</b></header>
      <strong>{agent.load}<small>%</small></strong>
      <p>PROCESS LOAD</p>
      <dl>
        <div><dt>ROLE</dt><dd>{agent.role}</dd></div>
        <div><dt>PULSE</dt><dd>{agent.pulse}</dd></div>
        <div><dt>BUILD</dt><dd>{agent.version}</dd></div>
      </dl>
      {/* Calibration trace to agent node */}
      <div className="trace-line" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ animationDelay: (i * 0.15) + 's' }} />)}
      </div>
    </aside>

    {/* System diagnostics — right side, doesn't overlap */}
    <div className="system-readout" aria-hidden="true">
      <div className="readout-row"><span>CORE</span><b>{agent.status === 'online' ? 'STABLE' : 'ALERT'}</b></div>
      <div className="readout-row"><span>FLEET</span><b>04/06 OPS</b></div>
      <div className="readout-row"><span>QUEUE</span><b>71 DEFERRED</b></div>
      <div className="readout-row"><span>UPTIME</span><b>54H</b></div>
      <div className="readout-row"><span>MESH</span><b>210-150</b></div>
    </div>
  </>
}

function MissionMode() {
  return <section className="projected-mode missions-projection">
    <header><span>MISSION FIELD</span><b>05 ACTIVE / 03 BLOCKED</b></header>
    {tasks.map((task, index) => (
      <div className={'projection-row ' + task.status.toLowerCase()} key={task.id}>
        <span>0{index + 1}</span><b>{task.id}</b><strong>{task.title}</strong><small>{task.agent}</small><em>{task.status}</em>
      </div>
    ))}
  </section>
}

function SignalMode() {
  return <section className="projected-mode signal-projection">
    <header><span>BUS SPECTRUM</span><b>LIVE / 05 EVENT</b></header>
    <div className="spectrum">{Array.from({ length: 46 }, (_, i) => <i key={i} style={{ height: (12 + ((i * 17) % 58)) + '%' }} />)}</div>
    {signals.map(signal => (
      <div className={'projection-row ' + signal.level} key={signal.time}>
        <b>{signal.time}</b><strong>{signal.source}</strong><small>{signal.message}</small>
      </div>
    ))}
  </section>
}

export function Workshop({ active, setActive, selectedAgent, setSelectedAgent, onPreview }) {
  const scene = React.useRef(null)
  const [pointer, setPointer] = React.useState({ x: 50, y: 55, active: false })
  const [plateOffset, setPlateOffset] = React.useState({ x: 0, y: 0 })

  const move = event => {
    const rect = scene.current.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * 100
    const py = ((event.clientY - rect.top) / rect.height) * 100
    setPointer({ x: px, y: py, active: true })
    setPlateOffset({ x: (px - 50) * 0.04, y: (py - 50) * 0.04 })
  }

  return (
    <div className="cinema-shell operator-shell" ref={scene}
      onPointerMove={move}
      onPointerLeave={() => { setPointer(v => ({ ...v, active: false })); setPlateOffset({ x: 0, y: 0 }) }}>

      {/* Background plate with parallax */}
      <div className="scene-plate operator-plate" aria-hidden="true"
        style={{ transform: 'translate(' + plateOffset.x + 'px, ' + plateOffset.y + 'px) scale(1.02)' }} />

      {/* Lens shade */}
      <div className="lens-shade" aria-hidden="true" />

      {/* Particle canvas — between plate and HUD */}
      <ParticleField agents={agents} selectedAgent={selectedAgent} />

      {/* Top meta bar */}
      <header className="cinema-meta">
        <span>JERICHO / OPERATOR BAY</span>
        <i>CONNECTED</i>
        <time>19:58:22 GST</time>
      </header>

      {/* Gesture nav — bottom left, recessed control strip */}
      <nav className="gesture-nav" aria-label="View mode">
        {['COMMAND', 'MISSIONS', 'SIGNALS'].map((item, index) => (
          <button key={item} className={active === item ? 'active' : ''} onClick={() => setActive(item)}>
            <span>0{index + 1}</span>{item}
          </button>
        ))}
      </nav>

      {/* Scene content */}
      <div className="scene-layer">
        {active === 'COMMAND' && <CoreModel selectedAgent={selectedAgent} />}
        {active === 'MISSIONS' && <MissionMode />}
        {active === 'SIGNALS' && <SignalMode />}
      </div>

      {/* Gesture cursor */}
      <div className={'gesture-cursor ' + (pointer.active ? 'visible' : '')}
        style={{ left: pointer.x + '%', top: pointer.y + '%' }}>
        <i /><span />
      </div>

      <CommandBar onPreview={onPreview} />

      {/* Film grain on top */}
      <div className="film-grain" aria-hidden="true" />
    </div>
  )
}
