import React from 'react'
import { agents, signals, tasks } from '../data'
import { CommandBar, StatusDot } from '../components'

const positions = {
  DEV: [35, 32], PA: [39, 61], IRIS: [65, 32], ANALYST: [51, 46], RESEARCH: [65, 61], INTEL: [82, 47],
}

function CoreMode({ selectedAgent, setSelectedAgent }) {
  const agent = agents.find(item => item.id === selectedAgent) || agents[0]
  return <>
    <button className="reactor-target" aria-label="Inspect Jericho fleet core"><span /><i /><b /></button>
    {agents.map(item => {
      const [x, y] = positions[item.id]
      return <button key={item.id} aria-label={`${item.id} ${item.role}`} className={`scene-hotspot ${item.status} ${selectedAgent === item.id ? 'selected' : ''}`} style={{ '--x': `${x}%`, '--y': `${y}%` }} onClick={() => setSelectedAgent(item.id)}><i /><span>{item.id}</span></button>
    })}
    <aside className={`telemetry-slab ${agent.status}`}>
      <header><StatusDot status={agent.status} /><span>NODE / {agent.id}</span><b>{agent.status}</b></header>
      <strong>{agent.load}<small>%</small></strong>
      <p>PROCESS LOAD</p>
      <dl><div><dt>ROLE</dt><dd>{agent.role}</dd></div><div><dt>PULSE</dt><dd>{agent.pulse}</dd></div><div><dt>BUILD</dt><dd>{agent.version}</dd></div></dl>
    </aside>
  </>
}

function MissionMode() {
  return <section className="projected-mode missions-projection">
    <header><span>MISSION FIELD</span><b>05 ACTIVE / 03 BLOCKED</b></header>
    {tasks.map((task, index) => <div className={`projection-row ${task.status.toLowerCase()}`} key={task.id}><span>0{index + 1}</span><b>{task.id}</b><strong>{task.title}</strong><small>{task.agent}</small><em>{task.status}</em></div>)}
  </section>
}

function SignalMode() {
  return <section className="projected-mode signal-projection">
    <header><span>BUS SPECTRUM</span><b>LIVE / 05 EVENT</b></header>
    <div className="spectrum">{Array.from({ length: 46 }, (_, i) => <i key={i} style={{ height: `${12 + ((i * 17) % 58)}%` }} />)}</div>
    {signals.map(signal => <div className={`projection-row ${signal.level}`} key={signal.time}><b>{signal.time}</b><strong>{signal.source}</strong><small>{signal.message}</small></div>)}
  </section>
}

export function Workshop({ active, setActive, selectedAgent, setSelectedAgent, onPreview }) {
  const scene = React.useRef(null)
  const [pointer, setPointer] = React.useState({ x: 50, y: 55, active: false })
  const move = event => {
    const rect = scene.current.getBoundingClientRect()
    setPointer({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100, active: true })
  }
  return <div className="cinema-shell operator-shell" ref={scene} onPointerMove={move} onPointerLeave={() => setPointer(value => ({ ...value, active: false }))}>
    <div className="scene-plate operator-plate" aria-hidden="true" />
    <div className="lens-shade" aria-hidden="true" />
    <header className="cinema-meta"><span>JERICHO / OPERATOR BAY</span><i>CONNECTED</i><time>19:58:22 GST</time></header>
    <nav className="gesture-nav" aria-label="View mode">
      {['COMMAND', 'MISSIONS', 'SIGNALS'].map((item, index) => <button key={item} className={active === item ? 'active' : ''} onClick={() => setActive(item)}><span>0{index + 1}</span>{item}</button>)}
    </nav>
    <div className="scene-layer">
      {active === 'COMMAND' && <CoreMode selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} />}
      {active === 'MISSIONS' && <MissionMode />}
      {active === 'SIGNALS' && <SignalMode />}
    </div>
    <div className={`gesture-cursor ${pointer.active ? 'visible' : ''}`} style={{ left: `${pointer.x}%`, top: `${pointer.y}%` }}><i /><span /></div>
    <CommandBar onPreview={onPreview} />
    <div className="film-grain" aria-hidden="true" />
  </div>
}
