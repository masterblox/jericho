import React from 'react'
import { CoreAssembly } from './components/CoreAssembly'
import { ParticleField } from './components/ParticleField'
import { IdCluster, GaugeCluster, MissionsCluster, SignalsCluster, MissionsProjection, SignalsProjection } from './components/peripherals'

export default function Scene({ coreState, mode, selectedAgent, setSelectedAgent, activeView, setActiveView }) {
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
      ref={stage}
      onPointerMove={onPointerMove}
    >
      <svg className="traces" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline pathLength="100" points="4,9 26,9 34,20" />
        <polyline pathLength="100" points="96,7 78,7 68,18" />
        <polyline pathLength="100" points="4,84 24,84 35,72" />
        <polyline pathLength="100" points="96,84 76,84 65,72" />
      </svg>
      <div className="layer layer-particles" aria-hidden="true">
        <ParticleField />
      </div>
      <div className="layer layer-far">
        <IdCluster activeView={activeView} onView={setActiveView} coreState={coreState} />
        <GaugeCluster />
      </div>
      <div className="layer layer-mid">
        <CoreAssembly selected={selectedAgent} onSelect={setSelectedAgent} />
      </div>
      <div className="layer layer-near">
        {activeView === 'MISSIONS' && <MissionsProjection onReturn={() => setActiveView('CORE')} />}
        {activeView === 'SIGNALS' && <SignalsProjection onReturn={() => setActiveView('CORE')} />}
        <MissionsCluster onSummon={() => setActiveView('MISSIONS')} />
        <SignalsCluster onSummon={() => setActiveView('SIGNALS')} />
      </div>
    </div>
  )
}
