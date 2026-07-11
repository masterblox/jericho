import React from 'react'

export function StatusDot({ status }) {
  return <span className={`status-dot ${status}`} aria-label={status} />
}

export function DispatchModal({ directive, onClose, onDispatch }) {
  if (!directive) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section className="dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-title">
      <header><span className="micro">DIRECTIVE DECOMPOSITION / HUMAN GATE</span><button onClick={onClose} aria-label="Close">×</button></header>
      <div className="modal-body">
        <p className="micro cy">DIRECTIVE</p>
        <h2 id="dispatch-title">{directive}</h2>
        <ol className="dispatch-route">
          <li className="step"><span className="step-num">01</span><strong>ANALYZE</strong><small>JERICHO / 4 SEC</small></li>
          <li aria-hidden="true" className="route-line" />
          <li className="step"><span className="step-num">02</span><strong>ASSIGN</strong><small>DEV + ANALYST</small></li>
          <li aria-hidden="true" className="route-line" />
          <li className="step"><span className="step-num">03</span><strong>VERIFY</strong><small>HUMAN GATE</small></li>
        </ol>
        <p className="risk-note"><span>LOW RISK</span> NO EXTERNAL MESSAGES · NO DESTRUCTIVE ACTIONS</p>
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
