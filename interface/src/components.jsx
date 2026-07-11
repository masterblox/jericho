import React from 'react'
import { agents } from './data'

export function StatusDot({ status }) {
  return <span className={`status-dot ${status}`} aria-label={status} />
}

// real decomposition: route agents + risk from the directive text, not a fixed plate
const ROUTE_HINTS = [
  [/recover|fix|deploy|build|patch|close|debug|ship/i, 'DEV'],
  [/research|synthes|investigat|compare|explore/i, 'RESEARCH'],
  [/verify|audit|analy|review|check/i, 'ANALYST'],
  [/auth|session|schedule|calendar|telethon|ops/i, 'PA'],
  [/signal|monitor|watch|scan|intel/i, 'INTEL'],
  [/design|visual|ui|interface|brand/i, 'IRIS'],
]
const RISK_RE = /delete|drop|purge|deploy|prod|external|payment|send|wipe/i

export function decompose(text) {
  const ids = new Set()
  for (const agent of agents) {
    if (new RegExp(`\\b${agent.id}\\b`, 'i').test(text)) ids.add(agent.id)
  }
  for (const [re, id] of ROUTE_HINTS) if (re.test(text)) ids.add(id)
  if (ids.size === 0) { ids.add('DEV'); ids.add('ANALYST') }
  const assigned = [...ids].slice(0, 3)
  return {
    assigned: assigned.join(' + '),
    degradedRoute: assigned.some(id => agents.find(a => a.id === id)?.status === 'degraded'),
    risky: RISK_RE.test(text),
    secs: Math.max(2, Math.min(9, Math.round(text.length / 12))),
  }
}

export function DispatchModal({ directive, onClose, onDispatch }) {
  if (!directive) return null
  const route = decompose(directive)
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section className="dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-title">
      <header><span className="micro">DIRECTIVE DECOMPOSITION / HUMAN GATE</span><button onClick={onClose} aria-label="Close">×</button></header>
      <div className="modal-body">
        <p className="micro cy">DIRECTIVE</p>
        <h2 id="dispatch-title">{directive}</h2>
        <ol className="dispatch-route">
          <li className="step"><span className="step-num">01</span><strong>ANALYZE</strong><small>JERICHO / {route.secs} SEC</small></li>
          <li aria-hidden="true" className="route-line" />
          <li className="step"><span className="step-num">02</span><strong>ASSIGN</strong><small>{route.assigned}</small></li>
          <li aria-hidden="true" className="route-line" />
          <li className="step"><span className="step-num">03</span><strong>VERIFY</strong><small>HUMAN GATE</small></li>
        </ol>
        {route.risky
          ? <p className="risk-note high"><span>HIGH RISK</span> DESTRUCTIVE / EXTERNAL PATH · HUMAN GATE MANDATORY</p>
          : <p className="risk-note"><span>LOW RISK</span> NO EXTERNAL MESSAGES · NO DESTRUCTIVE ACTIONS</p>}
        {route.degradedRoute && <p className="risk-note high"><span>DEGRADED</span> AN ASSIGNED NODE IS DEGRADED · EXPECT RETRIES</p>}
      </div>
      <footer><button className="ghost" onClick={onClose}>CANCEL</button><button className="confirm" onClick={onDispatch}>CONFIRM DISPATCH</button></footer>
    </section>
  </div>
}

export function Toast({ message }) {
  return <div className={`toast ${message ? 'visible' : ''}`} role="status">
    {message && <><StatusDot status="online" /> {message}</>}
  </div>
}
