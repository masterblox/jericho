import React from 'react'
import Scene from './Scene'
import { DispatchModal, Toast } from './components'
import { DevPanel } from './components/DevPanel'
import { store, api, installJerichoApi } from './jericho-api'

const VIEW_KEYS = { '1': 'CORE', '2': 'MISSIONS', '3': 'SIGNALS' }

export default function App() {
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)

  React.useEffect(() => installJerichoApi(), [])

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
      />
      <DispatchModal directive={state.directive} onClose={api.cancelDispatch} onDispatch={api.confirmDispatch} />
      <Toast message={state.toast} />
      <DevPanel />
    </main>
  )
}
