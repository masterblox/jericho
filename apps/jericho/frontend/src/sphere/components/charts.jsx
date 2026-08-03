import React from 'react'

// Bklit-style shaped-bar charts (native SVG, monotone).
// Bars are built from discrete shaped units — square, rounded, circle —
// with an optional hatch-pattern fill for the unlit remainder.

let patternSeq = 0

function Unit({ mode, x, y, w, h, lit, fault, patternId }) {
  const fill = lit ? (fault ? 'var(--fault)' : 'var(--b4)') : patternId ? `url(#${patternId})` : 'var(--b1)'
  if (mode === 'circle') {
    const r = Math.min(w, h) / 2
    return <circle cx={x + w / 2} cy={y + h / 2} r={r} fill={fill} />
  }
  return <rect x={x} y={y} width={w} height={h} rx={mode === 'round' ? Math.min(w, h) / 3 : 0} fill={fill} />
}

// Segmented meter: `lit` of `total` units light up.
export function SegBar({ value, max = 100, units = 10, mode = 'square', pattern = true, fault = false, width = 90, height = 8 }) {
  const id = React.useMemo(() => `hatch-${++patternSeq}`, [])
  const lit = Math.round((Math.min(value, max) / max) * units)
  const gap = 2
  const uw = (width - gap * (units - 1)) / units
  return <svg className="segbar" width={width} height={height} role="img" aria-label={`${value} of ${max}`}>
    {pattern && <defs>
      <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" fill="transparent" />
        <line x1="0" y1="0" x2="0" y2="4" stroke="var(--b1)" strokeWidth="1.4" />
      </pattern>
    </defs>}
    {Array.from({ length: units }, (_, i) => (
      <Unit key={i} mode={mode} x={i * (uw + gap)} y={0} w={uw} h={height} lit={i < lit} fault={fault} patternId={pattern ? id : null} />
    ))}
  </svg>
}

// Mini bar series (trend), each bar height = value, shaped units per Bklit.
export function Sparkbars({ series, mode = 'round', width = 96, height = 26, fault = false }) {
  const max = Math.max(...series, 1)
  const gap = 2
  const bw = (width - gap * (series.length - 1)) / series.length
  return <svg className="sparkbars" width={width} height={height} role="img" aria-label={`trend ${series.join(' ')}`}>
    {series.map((v, i) => {
      const h = Math.max(2, (v / max) * height)
      const isLast = i === series.length - 1
      return <rect
        key={i}
        x={i * (bw + gap)} y={height - h} width={bw} height={h}
        rx={mode === 'round' ? bw / 3 : 0}
        fill={isLast ? (fault ? 'var(--fault)' : 'var(--b4)') : 'var(--b2)'}
      />
    })}
  </svg>
}
