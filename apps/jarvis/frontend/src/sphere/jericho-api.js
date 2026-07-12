// Jericho control surface.
// Single external store for scene state + window.jericho, the programmatic API
// the voice/gesture bridge (apps/jarvis) drives. Every mutation notifies React
// subscribers and emits `jericho:state` for non-React listeners.

const CORE_STATES = ['idle', 'listening', 'thinking', 'speaking', 'alert']
const VIEWS = ['CORE', 'AGENTS', 'TASKS', 'BRAIN']
const MODES = ['jarvis', 'megatron']

// Live agent order comes from persisted Core missions via api.setAgents.
// No fixture roster: with no live agents there is no selection.
let order = []

let snapshot = {
  coreState: 'idle',
  mode: 'jarvis',
  selectedAgent: null,
  activeView: 'CORE',
  directive: '',
  toast: '',
}

const listeners = new Set()
let toastTimer = null
let dispatchHandler = null

function commit(partial) {
  snapshot = { ...snapshot, ...partial }
  listeners.forEach(fn => fn())
  window.dispatchEvent(new CustomEvent('jericho:state', { detail: snapshot }))
}

export const store = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  getSnapshot: () => snapshot,
}

export const api = {
  setCoreState(state) {
    if (CORE_STATES.includes(state)) commit({ coreState: state })
  },
  // 0..1 speech amplitude — written straight to a CSS var, no React churn
  setLevel(value) {
    const level = Math.max(0, Math.min(1, Number(value) || 0))
    document.querySelector('.stage')?.style.setProperty('--core-level', level.toFixed(3))
  },
  setMode(mode) {
    if (MODES.includes(mode)) commit({ mode })
  },
  setAgents(ids) {
    order = Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string' && id))] : []
    if (!order.includes(snapshot.selectedAgent)) {
      commit({ selectedAgent: order[0] ?? null })
    }
  },
  select(agentId) {
    if (order.includes(agentId)) commit({ selectedAgent: agentId })
  },
  cycle(step = 1) {
    if (!order.length) return
    const i = order.indexOf(snapshot.selectedAgent)
    commit({ selectedAgent: order[(i + step + order.length) % order.length] })
  },
  summon(view) {
    if (VIEWS.includes(view)) commit({ activeView: view })
  },
  dispatch(text) {
    if (typeof text === 'string' && text.trim()) commit({ directive: text.trim() })
  },
  async confirmDispatch() {
    if (!snapshot.directive) return
    const directive = snapshot.directive
    commit({ directive: '' })
    if (!dispatchHandler) { api.toast('CORE UNAVAILABLE · DIRECTIVE NOT SENT'); return }
    try {
      await dispatchHandler(directive)
      api.toast('DIRECTIVE CAPTURED · TRACKING ACTIVE')
    } catch {
      api.toast('CAPTURE FAILED · DIRECTIVE NOT SENT')
    }
  },
  cancelDispatch() { commit({ directive: '' }) },
  toast(message) {
    clearTimeout(toastTimer)
    commit({ toast: message })
    toastTimer = setTimeout(() => commit({ toast: '' }), 3200)
  },
}

export function setDirectiveHandler(handler) {
  dispatchHandler = typeof handler === 'function' ? handler : null
  return () => { if (dispatchHandler === handler) dispatchHandler = null }
}

export function installJerichoApi() {
  window.jericho = api
  return () => { if (window.jericho === api) delete window.jericho }
}
