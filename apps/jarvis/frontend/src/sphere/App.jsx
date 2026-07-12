import React from 'react'
import Scene from './Scene'
import { DispatchModal, Toast } from './components'
import { store, api, installJerichoApi, setDirectiveHandler } from './jericho-api'
import { CommandOverlay } from './CommandOverlay'

const VIEW_KEYS = { '1': 'CORE', '2': 'AGENTS', '3': 'TASKS', '4': 'BRAIN' }

export default function App({ liveData, onDirective, onVaultSearch, commandActions }) {
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [guidedTestSession, setGuidedTestSession] = React.useState(0)
  const [guidedTestActive, setGuidedTestActive] = React.useState(false)

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
    const start = event => {
      if (event.detail?.test !== 'isabella') return
      setGuidedTestSession(current => current + 1)
      setGuidedTestActive(true)
      setCommandOpen(true)
    }
    const resume = event => {
      if (event.detail?.test !== 'isabella') return
      setGuidedTestActive(true)
      setCommandOpen(true)
    }
    const end = event => {
      if (event.detail?.test !== 'isabella') return
      setGuidedTestActive(false)
      setCommandOpen(false)
    }
    document.addEventListener('jericho:guided-test-start', start)
    document.addEventListener('jericho:guided-test-resume', resume)
    document.addEventListener('jericho:guided-test-end', end)
    return () => {
      document.removeEventListener('jericho:guided-test-start', start)
      document.removeEventListener('jericho:guided-test-resume', resume)
      document.removeEventListener('jericho:guided-test-end', end)
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
        else api.summon('CORE')
        return
      }
      if (modalOpen) {
        if (event.key === 'Enter') { event.preventDefault(); api.confirmDispatch() }
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); api.cycle(1) }
      else if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); api.cycle(-1) }
      else if (VIEW_KEYS[event.key]) api.summon(VIEW_KEYS[event.key])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.directive])

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
        onVaultSearch={onVaultSearch}
        onOpenCommand={() => setCommandOpen(true)}
      />
      <CommandOverlay open={commandOpen} onClose={() => setCommandOpen(false)} liveData={liveData} guidedTestSession={guidedTestSession} guidedTestActive={guidedTestActive} actions={{
        ...commandActions,
        dispatchDirective: api.dispatch,
      }} />
      <DispatchModal directive={state.directive} onClose={api.cancelDispatch} onDispatch={api.confirmDispatch} />
      <Toast message={state.toast} />
    </main>
  )
}
