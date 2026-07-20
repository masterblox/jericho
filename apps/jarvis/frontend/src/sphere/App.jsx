import React from 'react'
import Scene from './Scene'
import { DispatchModal, Toast } from './components'
import { store, api, installJerichoApi, setDirectiveHandler } from './jericho-api'
import { CommandOverlay } from './CommandOverlay'

const VIEW_KEYS = { '1': 'CORE', '2': 'AGENTS', '3': 'TASKS', '4': 'BRAIN' }

export default function App({ liveData, health, onDirective, onVaultSearch, commandActions }) {
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [commandOpen, setCommandOpen] = React.useState(false)

  React.useEffect(() => installJerichoApi(), [])
  React.useEffect(() => setDirectiveHandler(onDirective), [onDirective])

  // live roster only: agent selection follows persisted Core missions
  React.useEffect(() => {
    api.setAgents((liveData?.agents ?? []).map(agent => agent.id))
  }, [liveData])

  React.useEffect(() => {
    const open = event => {
      if (event.target?.closest?.('[data-gesture-target="core-command"]')) setCommandOpen(true)
    }
    document.addEventListener('jericho:context', open)
    return () => document.removeEventListener('jericho:context', open)
  }, [])

  React.useEffect(() => {
    const close = () => setCommandOpen(false)
    document.addEventListener('jericho:close-command-overlay', close)
    return () => document.removeEventListener('jericho:close-command-overlay', close)
  }, [])

  // Guided lifecycle: start/resume/phase/end update native Scene state.
  // The command overlay is never opened for guided or natural knowledge events.
  React.useEffect(() => {
    const onStart = event => {
      const detail = event.detail
      if (detail?.test) {
        setCommandOpen(false)
        api.startGuidedTest(detail.test)
      }
    }
    const onResume = event => {
      const detail = event.detail
      if (detail?.test) {
        setCommandOpen(false)
        api.resumeGuidedTest(detail.test)
      }
    }
    const onPhase = event => {
      const detail = event.detail
      if (detail?.phase) api.updateGuidedPhase(detail.phase)
    }
    const onEnd = () => api.endGuidedTest()

    document.addEventListener('jericho:guided-test-start', onStart)
    document.addEventListener('jericho:guided-test-resume', onResume)
    document.addEventListener('jericho:guided-test-phase', onPhase)
    document.addEventListener('jericho:guided-test-end', onEnd)
    return () => {
      document.removeEventListener('jericho:guided-test-start', onStart)
      document.removeEventListener('jericho:guided-test-resume', onResume)
      document.removeEventListener('jericho:guided-test-phase', onPhase)
      document.removeEventListener('jericho:guided-test-end', onEnd)
    }
  }, [])

  // silent dev fallback — no visible affordance; the real inputs are hand + voice
  React.useEffect(() => {
    const onKey = event => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      const modalOpen = Boolean(state.directive)
      if (event.key === 'Escape') {
        if (modalOpen) api.cancelDispatch()
        else if (state.guidedTest) {
          // Escape during guided test dismisses but preserves state
          api.endGuidedTest()
        } else api.summon('CORE')
        return
      }
      if (modalOpen) {
        if (event.key === 'Enter') { event.preventDefault(); api.confirmDispatch() }
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); api.cycle(1) }
      else if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); api.cycle(-1) }
      else if (VIEW_KEYS[event.key]) api.summon(VIEW_KEYS[event.key])
      else if (event.key === '5' || event.key === 'V') api.summon('VOICE')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.directive, state.guidedTest])

  return (
    <main className="app" data-variant="workshop">
      <Scene
        coreState={state.coreState}
        mode={state.mode}
        selectedAgent={state.selectedAgent}
        setSelectedAgent={api.select}
        activeView={state.activeView}
        setActiveView={api.summon}
        liveData={liveData}
        health={health}
        onVaultSearch={onVaultSearch}
        onOpenCommand={() => setCommandOpen(true)}
        knowledgeActions={commandActions}
        guidedTest={state.guidedTest}
      />
      <CommandOverlay open={commandOpen} onClose={() => setCommandOpen(false)} liveData={liveData} actions={{
        ...commandActions,
        dispatchDirective: api.dispatch,
      }} />
      <DispatchModal directive={state.directive} onClose={api.cancelDispatch} onDispatch={api.confirmDispatch} />
      <Toast message={state.toast} />
    </main>
  )
}
