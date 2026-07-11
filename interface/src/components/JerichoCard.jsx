import React from 'react'

// HADAL C2 card grammar as Jarvis windows: corner-bracket hairline frame,
// eyebrow header, BIG typed-on value, breakdown rows, provenance footer.
// Stroke-and-light only — no filled surfaces.

// port of HADAL's useC2Type: numerals count up, strings type on
export function useTypeOn(value, delay = 0, duration = 520) {
  const [out, setOut] = React.useState(typeof value === 'number' ? 0 : '')
  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setOut(value); return }
    let raf = 0
    const start = performance.now() + delay
    const tick = now => {
      const t = Math.max(0, Math.min(1, (now - start) / duration))
      const eased = 1 - Math.pow(1 - t, 3)
      if (typeof value === 'number') setOut(Math.round(value * eased))
      else setOut(value.slice(0, Math.ceil(value.length * eased)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, delay, duration])
  return out
}

export function Chip({ children, tone = '' }) {
  return <span className={`chip ${tone}`}>{children}</span>
}

export function JerichoCard({ eyebrow, source, chip, chipTone, big, bigUnit, label, children, provenance, tone = '', index = 0, className = '', ...props }) {
  const typedBig = useTypeOn(big ?? '', 120 + index * 60)
  return <article className={`jcard ${tone} ${className}`} style={{ '--ci': index }} {...props}>
    <i className="jc-bracket tl" aria-hidden="true" /><i className="jc-bracket tr" aria-hidden="true" />
    <i className="jc-bracket bl" aria-hidden="true" /><i className="jc-bracket br" aria-hidden="true" />
    <div className="jc-scan" aria-hidden="true" />
    {(eyebrow || chip) && <header className="jc-head">
      <span className="micro">{eyebrow}</span>
      {source && <span className="micro jc-src">{source}</span>}
      {chip && <Chip tone={chipTone}>{chip}</Chip>}
    </header>}
    {big !== undefined && <div className="jc-big mononum">{typedBig}<span>{bigUnit}</span></div>}
    {label && <div className="jc-label micro">{label}</div>}
    {children}
    {provenance && <footer className="jc-prov micro">{provenance}</footer>}
  </article>
}

export function BreakdownRow({ label, value, children }) {
  return <div className="jc-brow">
    <span className="micro jc-bname">{label}</span>
    {children}
    <span className="jc-bval mononum">{value}</span>
  </div>
}
