import React from 'react'
import { CoreAssembly } from './components/CoreAssembly'
import { ParticleField } from './components/ParticleField'
import { IdCluster, MissionsProjection, SignalsProjection } from './components/peripherals'

export default function Scene({ coreState, mode, selectedAgent, activeView, setActiveView }) {
  const stage = React.useRef(null)
  const frame = React.useRef(0)

  const onPointerMove = event => {
    cancelAnimationFrame(frame.current)
    const { clientX, clientY } = event
    frame.current = requestAnimationFrame(() => {
      const el = stage.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      el.style.setProperty('--px', ((clientX - rect.left) / rect.width - 0.5) * 2)
      el.style.setProperty('--py', ((clientY - rect.top) / rect.height - 0.5) * 2)
    })
  }

  const summoned = activeView !== 'CORE'
  return (
    <div
      className={`stage ${summoned ? 'summoned' : ''}`}
      data-core-state={coreState}
      data-mode={mode}
      data-agent={selectedAgent}
      ref={stage}
      onPointerMove={onPointerMove}
    >
      <div className="layer layer-particles" aria-hidden="true">
        <ParticleField />
      </div>
      <div className="layer layer-far">
        <IdCluster activeView={activeView} onView={setActiveView} coreState={coreState} />
      </div>
      <div className="layer layer-mid">
        <CoreAssembly />
      </div>
      <div className="layer layer-near">
        {activeView === 'MISSIONS' && <MissionsProjection />}
        {activeView === 'SIGNALS' && <SignalsProjection />}
      </div>
    </div>
  )
}
