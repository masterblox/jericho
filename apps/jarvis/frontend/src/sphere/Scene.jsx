import React from 'react'
import { CoreAssembly } from './components/CoreAssembly'
import { ParticleField } from './components/ParticleField'
import { AgentsProjection, BrainProjection, FleetLifecycle, IdCluster, TasksProjection } from './components/peripherals'
import { StartupHealthCard } from './StartupHealthCard'
import { VoiceCalibrationCard } from './VoiceCalibrationCard'
import { KnowledgeProjection } from './KnowledgeProjection'

export default function Scene({ coreState, mode, selectedAgent, activeView, setActiveView, liveData, health, onVaultSearch, onOpenCommand, knowledgeActions, guidedTest }) {
  const stage = React.useRef(null)
  const frame = React.useRef(0)
  const gestureOffset = React.useRef({ x: 0, y: 0 })

  React.useEffect(() => {
    const camera = event => {
      if (event.detail?.phase !== 'move') return
      gestureOffset.current.x += event.detail.delta?.x ?? 0
      gestureOffset.current.y += event.detail.delta?.y ?? 0
      stage.current?.style.setProperty('--px', Math.max(-1, Math.min(1, gestureOffset.current.x / 240)))
      stage.current?.style.setProperty('--py', Math.max(-1, Math.min(1, gestureOffset.current.y / 240)))
    }
    const depth = event => {
      const current = Number(stage.current?.dataset.semanticDepth ?? 0)
      const next = Math.max(-3, Math.min(3, current + (event.detail?.delta ?? 0)))
      if (stage.current) stage.current.dataset.semanticDepth = String(next)
      stage.current?.style.setProperty('--semantic-depth', String(next))
    }
    document.addEventListener('jericho:nucleus-camera', camera)
    document.addEventListener('jericho:nucleus-depth', depth)
    return () => {
      document.removeEventListener('jericho:nucleus-camera', camera)
      document.removeEventListener('jericho:nucleus-depth', depth)
    }
  }, [])

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

  const summoned = activeView !== 'CORE' && activeView !== 'VOICE'
  // VoiceCalibrationCard only in a manually opened administrative Voice mode
  const showVoice = activeView === 'VOICE'

  return (
    <div
      className={`stage ${summoned ? 'summoned' : ''}`}
      data-core-state={coreState}
      data-mode={mode}
      data-agent={selectedAgent}
      data-jericho-nucleus-space="true"
      data-guided={guidedTest?.active ? guidedTest.test : undefined}
      data-guided-phase={guidedTest?.phase ?? undefined}
      ref={stage}
      onPointerMove={onPointerMove}
    >
      <div className="layer layer-particles" aria-hidden="true">
        <ParticleField agents={liveData?.agents ?? []} />
      </div>
      <div className="layer layer-far">
        <IdCluster activeView={activeView} onView={setActiveView} coreState={coreState} connected={liveData?.connected} />
        <FleetLifecycle stages={liveData?.fleetStages ?? []} />
      </div>
      <div className="layer layer-mid">
        <CoreAssembly onOpenCommand={onOpenCommand} />
      </div>
      <div className="layer layer-near">
        <StartupHealthCard health={health} />
        <KnowledgeProjection actions={knowledgeActions} />
        {showVoice && <VoiceCalibrationCard />}
        {activeView === 'AGENTS' && <AgentsProjection fleet={liveData?.fleet} />}
        {activeView === 'TASKS' && <TasksProjection tasks={liveData?.tasks ?? []} fleet={liveData?.fleet} />}
        {activeView === 'BRAIN' && <BrainProjection nucleus={liveData?.nucleus} onSearch={onVaultSearch} />}
      </div>
    </div>
  )
}
