import React from 'react'
import { agents, signals, tasks } from '../data'
import { CommandBar, StatusDot } from '../components'

const spatialPositions = {
  DEV: [13, 55], PA: [31, 60], IRIS: [48, 38], ANALYST: [64, 58], RESEARCH: [77, 60], INTEL: [92, 53],
}

function SpatialAgents({ selectedAgent, setSelectedAgent }) {
  const selected = agents.find(item => item.id === selectedAgent) || agents[0]
  return <>
    {agents.map(item => {
      const [x, y] = spatialPositions[item.id]
      return <button key={item.id} className={`construct-hotspot ${item.status} ${selectedAgent === item.id ? 'selected' : ''}`} style={{ '--x': `${x}%`, '--y': `${y}%` }} onClick={() => setSelectedAgent(item.id)} aria-label={`${item.id} ${item.role}`}><span /><i /></button>
    })}
    <aside className={`construct-readout ${selected.status}`}>
      <header><StatusDot status={selected.status} />ENTITY LOCK / {selected.id}</header>
      <div><strong>{selected.id}</strong><b>{selected.load}%</b></div>
      <p>{selected.role} / PULSE {selected.pulse} / {selected.version}</p>
      <small>OPEN PALM TO HOLD<br />LATERAL THROW TO ROUTE</small>
    </aside>
  </>
}

function SpatialMissions() {
  return <section className="spatial-stack">
    <header>MISSION OBJECTS <b>05</b></header>
    {tasks.map((task, index) => <div key={task.id} className={`spatial-object o${index + 1} ${task.status.toLowerCase()}`}><i /><span>{task.id}</span><strong>{task.title}</strong><small>{task.status}</small></div>)}
  </section>
}

function SpatialSignals() {
  return <section className="spatial-stack signal-stack">
    <header>FIELD EVENTS <b>LIVE</b></header>
    {signals.map((signal, index) => <div key={signal.time} className={`spatial-object o${index + 1} ${signal.level}`}><i /><span>{signal.time}</span><strong>{signal.source}</strong><small>{signal.message}</small></div>)}
  </section>
}

export function Hadal({ active, setActive, selectedAgent, setSelectedAgent, onPreview }) {
  const scene = React.useRef(null)
  const [pointer, setPointer] = React.useState({ x: 50, y: 52, active: false })
  const move = event => {
    const rect = scene.current.getBoundingClientRect()
    setPointer({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100, active: true })
  }
  return <div className="cinema-shell spatial-shell" ref={scene} onPointerMove={move} onPointerLeave={() => setPointer(value => ({ ...value, active: false }))}>
    <div className="scene-plate spatial-plate" aria-hidden="true" />
    <div className="lens-shade" aria-hidden="true" />
    <header className="cinema-meta"><span>JERICHO / SPATIAL FIELD</span><i>VOLUMETRIC LINK</i><time>19:58:22 GST</time></header>
    <nav className="gesture-nav" aria-label="View mode">
      {['COMMAND', 'MISSIONS', 'SIGNALS'].map((item, index) => <button key={item} className={active === item ? 'active' : ''} onClick={() => setActive(item)}><span>0{index + 1}</span>{item}</button>)}
    </nav>
    <div className="scene-layer">
      {active === 'COMMAND' && <SpatialAgents selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} />}
      {active === 'MISSIONS' && <SpatialMissions />}
      {active === 'SIGNALS' && <SpatialSignals />}
    </div>
    <div className={`gesture-cursor ${pointer.active ? 'visible' : ''}`} style={{ left: `${pointer.x}%`, top: `${pointer.y}%` }}><i /><span /></div>
    <CommandBar onPreview={onPreview} />
    <div className="film-grain" aria-hidden="true" />
  </div>
}
