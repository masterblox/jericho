import React from 'react'
import { CoreSphere } from './CoreSphere'

// The centerpiece, dissected: the sphere is the interface.
// Around it only a near-static machined frame (two rings), the voice
// waveform ring, and the amplitude pulse ring. Dark space is the layout.

const rnd = i => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1

const pt = (r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]
}

function Frame() {
  return <svg className="frame" viewBox="0 0 100 100" aria-hidden="true">
    <g className="frame-main">
      <circle cx="50" cy="50" r="41" />
      {Array.from({ length: 36 }, (_, i) => {
        const a = i * 10
        const [x1, y1] = pt(41, a), [x2, y2] = pt(39.4, a)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
    </g>
    <circle className="frame-dash" cx="50" cy="50" r="34.5" strokeDasharray="6 3" />
  </svg>
}

function Waveform({ bars = 64 }) {
  return <svg className="waveform" viewBox="0 0 100 100" aria-hidden="true">
    {Array.from({ length: bars }, (_, i) => (
      <g key={i} transform={`rotate(${(i / bars) * 360} 50 50)`}>
        <line
          className="bar"
          x1="50" y1="18.5" x2="50" y2="16"
          style={{
            '--amp': (0.4 + rnd(i) * 0.45).toFixed(2),
            '--dur': `${Math.round(380 + rnd(i + 97) * 560)}ms`,
            animationDelay: `-${Math.round(rnd(i + 31) * 800)}ms`,
          }}
        />
      </g>
    ))}
  </svg>
}

export function CoreAssembly() {
  return <div className="core-wrap">
    <div className="halo" aria-hidden="true" />
    <div className="halo-hot" aria-hidden="true" />
    <Frame />
    <Waveform />
    <svg className="pulse-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="35.2" />
    </svg>
    <CoreSphere />
  </div>
}
