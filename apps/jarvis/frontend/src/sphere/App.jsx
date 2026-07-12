import React from 'react'
import Scene from './Scene'
import { DispatchModal, Toast } from './components'
import { store, api, installJerichoApi, setDirectiveHandler } from './jericho-api'
import { CommandOverlay } from './CommandOverlay'

const VIEW_KEYS = { '1': 'CORE', '2': 'MISSIONS', '3': 'SIGNALS' }

export default function App({ liveData, onDirective, commandActions }) {
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [commandOpen, setCommandOpen] = React.useState(false)

  React.useEffect(() => installJerichoApi(), [])
  React.useEffect(() => setDirectiveHandler(onDirective), [onDirective])
  React.useEffect(() => {
    const open = event => {
      if (event.target?.closest?.('[data-gesture-target="core-command"]')) setCommandOpen(true)
    }
    document.addEventListener('jericho:context', open)
    return () => document.removeEventListener('jericho:context', open)
  }, [])

  // silent dev fallback — no visible affordance; the real inputs are hand + voice
  React.useEffect(() => {
    const onKey = event => {
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
        onOpenCommand={() => setCommandOpen(true)}
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
