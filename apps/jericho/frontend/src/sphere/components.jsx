import React from 'react'
import { useTypeOn, Chip } from './components/JerichoCard'

export function StatusDot({ status }) {
  return <span className={`status-dot ${status}`} aria-label={status} />
}

// Local text heuristic only. Real classification, routing, and assignment
// happen in Jericho Core after capture — the modal must not fake them.
const RISK_RE = /delete|drop|purge|deploy|prod|external|payment|send|wipe/i

export function decompose(text) {
  return { risky: RISK_RE.test(text) }
}

function TypedDirective({ text }) {
  const typed = useTypeOn(text, 80, 640)
  return <h2 id="dispatch-title" aria-label={text}>{typed}<span className="caret" aria-hidden="true" /></h2>
}

export function DispatchModal({ directive, onClose, onDispatch }) {
  if (!directive) return null
  const route = decompose(directive)
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section className="dispatch-modal jcard-frame" role="dialog" aria-modal="true" aria-labelledby="dispatch-title">
      <i className="jc-bracket tl" aria-hidden="true" /><i className="jc-bracket tr" aria-hidden="true" />
      <i className="jc-bracket bl" aria-hidden="true" /><i className="jc-bracket br" aria-hidden="true" />
      <div className="jc-scan" aria-hidden="true" />
      <header>
        <span className="micro">DIRECTIVE DECOMPOSITION / HUMAN GATE</span>
        <Chip tone={route.risky ? 'fault' : 'ok'}>{route.risky ? 'HIGH RISK' : 'LOW RISK'}</Chip>
        <button onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="modal-body">
        <p className="micro cy">DIRECTIVE</p>
        <TypedDirective text={directive} />
        <ol className="dispatch-route">
          <li className="step"><span className="step-num">01</span><strong>CAPTURE</strong><small>ENCRYPTED LOCAL INTAKE</small></li>
          <li aria-hidden="true" className="route-line" />
          <li className="step"><span className="step-num">02</span><strong>ROUTE</strong><small>JERICHO CORE</small></li>
          <li aria-hidden="true" className="route-line" />
          <li className="step"><span className="step-num">03</span><strong>APPROVE</strong><small>HUMAN GATE</small></li>
        </ol>
        {route.risky
          ? <p className="risk-note high"><span>HIGH RISK</span> DESTRUCTIVE / EXTERNAL LANGUAGE DETECTED · HUMAN GATE MANDATORY</p>
          : <p className="risk-note"><span>LOW RISK</span> NOTHING EXECUTES WITHOUT EXPLICIT APPROVAL</p>}
      </div>
      <footer>
        <button className="ghost" data-gesture-target="dispatch:cancel" onClick={onClose}>CANCEL</button>
        <button className="confirm" data-gesture-target="dispatch:confirm" onClick={onDispatch}>CONFIRM DISPATCH</button>
      </footer>
    </section>
  </div>
}

export function Toast({ message }) {
  return <div className={`toast ${message ? 'visible' : ''}`} role="status">
    {message && <><StatusDot status="online" /> {message}</>}
  </div>
}
