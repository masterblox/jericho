import React from 'react'
import { agents, signals } from '../data'
import { StatusDot } from '../components'

const RADIUS = 41

export function ringPositions(radius = RADIUS) {
  return agents.map((a, i) => {
    const ang = ((-90 + i * 60) * Math.PI) / 180
    return { ...a, ang, nx: 50 + radius * Math.cos(ang), ny: 50 + radius * Math.sin(ang) }
  })
}

function Ticks({ r, count, len, className }) {
  const ticks = Array.from({ length: count }, (_, i) => {
    const ang = (i / count) * Math.PI * 2
    const cos = Math.cos(ang), sin = Math.sin(ang)
    return <line key={i} x1={50 + r * cos} y1={50 + r * sin} x2={50 + (r - len) * cos} y2={50 + (r - len) * sin} />
  })
  return <g className={className}>{ticks}</g>
}

function DegreeLabels({ r }) {
  return <g>
    {Array.from({ length: 12 }, (_, i) => {
      const deg = i * 30
      const ang = ((deg - 90) * Math.PI) / 180
      return <text key={deg} className="deg-label" x={50 + r * Math.cos(ang)} y={50 + r * Math.sin(ang)} textAnchor="middle" dominantBaseline="middle">{String(deg).padStart(3, '0')}</text>
    })}
  </g>
}

// deterministic pseudo-random so StrictMode double-renders stay stable
const rnd = i => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1

const pt = (r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]
}

// annular sector path (coil segments)
function sector(r1, r2, a1, a2) {
  const [ox1, oy1] = pt(r2, a1), [ox2, oy2] = pt(r2, a2)
  const [ix1, iy1] = pt(r1, a1), [ix2, iy2] = pt(r1, a2)
  return `M ${ox1} ${oy1} A ${r2} ${r2} 0 0 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${r1} ${r1} 0 0 0 ${ix1} ${iy1} Z`
}

// Fully procedural arc reactor — every layer is its own animatable element.
// Radii: lens 0-8 · spokes 8-12 · coils 12.5-21.5 · rotor 22-26 ·
// stator 26.8-28.6 · conduits 29-31 (waveform bars live at 31.5-34 outside).
function Reactor() {
  return <svg className="reactor" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <radialGradient id="plasma-core">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="45%" stopColor="#dbf1ff" />
        <stop offset="100%" stopColor="#9fd8ff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="plasma-mid">
        <stop offset="0%" stopColor="#bfe4ff" stopOpacity=".9" />
        <stop offset="100%" stopColor="#79cdff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="plasma-fringe" fx="42%" fy="42%">
        <stop offset="55%" stopColor="#9fd8ff" stopOpacity="0" />
        <stop offset="82%" stopColor="#9fd8ff" stopOpacity=".55" />
        <stop offset="100%" stopColor="#79cdff" stopOpacity="0" />
      </radialGradient>
    </defs>

    {/* spiral axis: caged inside the coil ring (4 -> 12), one turn */}
    <g className="spiral-g">
      {[0, 180].map(off => (
        <polyline key={off} className="spiral" points={
          Array.from({ length: 61 }, (_, i) => {
            const th = (i / 60) * 2 * Math.PI
            const r = 4 * Math.exp(0.1749 * th)
            return pt(r, (th * 180) / Math.PI + off).map(v => v.toFixed(2)).join(',')
          }).join(' ')
        } />
      ))}
    </g>

    {/* primary struts: spines from lens to conduit band, one terminal mount */}
    <g className="struts">
      {Array.from({ length: 6 }, (_, i) => {
        const a = i * 60
        const [x1, y1] = pt(8, a), [x2, y2] = pt(31.4, a)
        return <g key={i}>
          <line className="strut" x1={x1} y1={y1} x2={x2} y2={y2} />
          {[12.5, 21.5, 31.4].map(r => {
            const [jx, jy] = pt(r, a)
            return <rect key={r} className="junction" x={jx - .55} y={jy - .55} width="1.1" height="1.1" transform={`rotate(${a} ${jx} ${jy})`} />
          })}
        </g>
      })}
    </g>

    {/* boundary tick rings: coil seams only */}
    <g className="seams">
      {[12.5, 21.5].map(r => (
        <g key={r}>
          {Array.from({ length: 36 }, (_, i) => {
            const a = i * 10 + 5
            const [x1, y1] = pt(r - .4, a), [x2, y2] = pt(r + .4, a)
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
          })}
        </g>
      ))}
    </g>

    {/* conduits: energy visibly flowing, speed = --conduit-dur */}
    <g className="conduit-g">
      {[{ r: 29.2, c: 'c1', d: '14 10' }, { r: 30.1, c: 'c2', d: '7 16' }, { r: 31, c: 'c3', d: '22 12' }].map(({ r, c, d }) => (
        <circle key={c} className={`conduit ${c}`} cx="50" cy="50" r={r} pathLength="100" strokeDasharray={d} />
      ))}
    </g>

    {/* stator: machined mount ring + bolts, slow reverse drift */}
    <g className="stator-g">
      <g className="stator">
        <circle cx="50" cy="50" r="26.8" />
        <circle cx="50" cy="50" r="28.6" />
        {Array.from({ length: 12 }, (_, i) => {
          const [x, y] = pt(27.7, i * 30 + 15)
          return <circle key={i} className="bolt" cx={x} cy={y} r=".7" />
        })}
      </g>
    </g>

    {/* rotor: 24 closed swept-wedge fan blades, physically rotating */}
    <g className="rotor-g">
      <g className="rotor">
        {Array.from({ length: 24 }, (_, i) => {
          const a = i * 15
          const [i1x, i1y] = pt(22.2, a), [i2x, i2y] = pt(22.2, a + 6)
          const [o1x, o1y] = pt(25.8, a + 11), [o2x, o2y] = pt(25.8, a + 5)
          return <path key={i} className="blade"
            d={`M ${i1x} ${i1y} A 22.2 22.2 0 0 1 ${i2x} ${i2y} L ${o1x} ${o1y} A 25.8 25.8 0 0 0 ${o2x} ${o2y} Z`} />
        })}
        <circle className="rotor-hub" cx="50" cy="50" r="22" />
        <circle className="rotor-rim" cx="50" cy="50" r="25.9" />
      </g>
    </g>

    {/* coil ring: 12 segments — the circular VU meter, indexed */}
    <g className="coil-g">
      <g className="coil">
        {Array.from({ length: 12 }, (_, k) => (
          <path key={k} d={sector(12.5, 21.5, k * 30 + 3, k * 30 + 27)} style={{ '--k': k }} />
        ))}
      </g>
      <g className="coil-nums">
        {Array.from({ length: 12 }, (_, k) => {
          const [x, y] = pt(17, k * 30 + 15)
          return <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{String(k + 1).padStart(2, '0')}</text>
        })}
      </g>
    </g>

    {/* hub injectors: 4 static tapered mounts bridging lens to coil ring */}
    <g className="spokes-g">
      <g className="injectors">
        {[45, 135, 225, 315].map(a => (
          <path key={a} className="injector" d={`M ${pt(7.9, a - 2.6).join(' ')} L ${pt(12.5, a - 0.9).join(' ')} L ${pt(12.5, a + 0.9).join(' ')} L ${pt(7.9, a + 2.6).join(' ')} Z`} />
        ))}
      </g>
    </g>

    {/* plasma lens: the living heart */}
    <g className="lens-g">
      <g className="lens-shimmer s1"><circle cx="50" cy="50" r="7.6" fill="url(#plasma-fringe)" /></g>
      <g className="lens-shimmer s2"><circle cx="50" cy="50" r="7.2" fill="url(#plasma-fringe)" opacity=".7" /></g>
      <circle className="lens-mid" cx="50" cy="50" r="6" fill="url(#plasma-mid)" />
      <circle className="lens-core" cx="50" cy="50" r="4.2" fill="url(#plasma-core)" />
      <circle className="lens-ring" cx="50" cy="50" r="7.9" />
    </g>
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
            '--dur': `${Math.round(260 + rnd(i + 97) * 420)}ms`,
            animationDelay: `-${Math.round(rnd(i + 31) * 600)}ms`,
          }}
        />
      </g>
    ))}
  </svg>
}

function Satellites() {
  return <>
    {[{ r: 46.5, cls: 'o1' }, { r: 34.5, cls: 'o3' }].map(({ r, cls }) => (
      <div key={cls} className={`sat-orbit ${cls}`} aria-hidden="true">
        <i className="sat" style={{ top: `${50 - r}%` }} />
      </div>
    ))}
  </>
}

function Dust({ count = 18 }) {
  return <div className="dust" aria-hidden="true">
    {Array.from({ length: count }, (_, i) => (
      <i key={i} style={{
        left: `${8 + rnd(i + 7) * 84}%`,
        top: `${8 + rnd(i + 53) * 84}%`,
        '--dd': `${(4 + rnd(i + 11) * 9).toFixed(1)}s`,
        animationDelay: `-${(rnd(i + 3) * 8).toFixed(1)}s`,
      }} />
    ))}
  </div>
}

function Reticle() {
  const arc = (a1, a2, r) => {
    const p = a => [50 + r * Math.cos((a - 90) * Math.PI / 180), 50 + r * Math.sin((a - 90) * Math.PI / 180)]
    const [x1, y1] = p(a1); const [x2, y2] = p(a2)
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`
  }
  return <svg className="reticle" viewBox="0 0 100 100" aria-hidden="true">
    {[15, 105, 195, 285].map(a => <path key={a} d={arc(a, a + 42, 43.2)} />)}
  </svg>
}

function Rings() {
  return <svg className="rings" viewBox="0 0 100 100" aria-hidden="true">
    <g className="ring-a">
      <circle className="ring-draw" cx="50" cy="50" r="46.5" stroke="var(--stroke-dim)" strokeWidth="0.7" strokeDasharray="0.4 1.6" />
      <Ticks r={46.5} count={120} len={1.1} className="tick-fine" />
    </g>
    <g className="ring-b">
      <circle className="ring-draw" cx="50" cy="50" r="41" stroke="var(--stroke)" strokeWidth="0.9" />
      <Ticks r={41} count={36} len={1.8} className="tick-main" />
      <path d="M 50 9 A 41 41 0 0 1 91 50" stroke="var(--amber-stroke)" strokeWidth="1.1" />
    </g>
    <g className="ring-c">
      <circle className="ring-draw" cx="50" cy="50" r="34.5" stroke="var(--stroke-dim)" strokeWidth="0.7" strokeDasharray="6 3" />
    </g>
    <DegreeLabels r={37.8} />
    <style>{`.tick-fine line{stroke:var(--stroke-dim);stroke-width:.5}.tick-main line{stroke:var(--stroke);stroke-width:.7}`}</style>
  </svg>
}

function Leader({ node }) {
  const right = node.nx >= 50
  const ex = node.nx + (right ? 11 : -11)
  const tx = node.nx + (right ? 15 : -15)
  const y = node.ny - 6
  // calibration ticks along the horizontal run
  const ticks = [0.3, 0.55, 0.8].map(f => ex + (tx - ex) * f)
  return <svg className={`leader ${node.status}`} viewBox="0 0 100 100" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
    <circle cx={node.nx} cy={node.ny} r="0.7" />
    <polyline points={`${node.nx},${node.ny} ${ex},${y} ${tx},${y}`} vectorEffect="non-scaling-stroke" />
    {ticks.map(x => <line key={x} className="leader-tick" x1={x} y1={y - 0.7} x2={x} y2={y + 0.7} vectorEffect="non-scaling-stroke" />)}
    <rect className="leader-cap" x={tx - 0.5} y={y - 0.5} width="1" height="1" />
  </svg>
}

function Callout({ node }) {
  const right = node.nx >= 50
  const last = signals.find(s => s.source === node.id)
  const style = right
    ? { left: `calc(${node.nx + 15}% + 6px)`, top: `${node.ny - 6}%`, transform: 'translateY(-12px)' }
    : { left: `calc(${node.nx - 15}% - 6px)`, top: `${node.ny - 6}%`, transform: 'translate(-100%, -12px)', justifyItems: 'end', textAlign: 'right' }
  return <div className={`callout ${node.status}`} style={style}>
    <header><strong>{node.id}</strong><span className="micro">{node.status}</span></header>
    <div className="rule" />
    <dl>
      <div><dt>ROLE</dt><dd>{node.role}</dd></div>
      <div><dt>LOAD</dt><dd>{node.load}%</dd></div>
      <div><dt>PULSE</dt><dd>{node.pulse}</dd></div>
      <div><dt>BUILD</dt><dd>{node.version}</dd></div>
    </dl>
    {last && <p className="micro last">{last.message}</p>}
  </div>
}

export function CoreAssembly({ selected, onSelect }) {
  const nodes = ringPositions()
  const current = nodes.find(n => n.id === selected)
  return <div className="core-wrap">
    <div className="halo" aria-hidden="true" />
    <div className="halo-hot" aria-hidden="true" />
    <Dust />
    <div className="scanner" aria-hidden="true" />
    <Rings />
    <Satellites />
    <Reticle />
    <Waveform />
    <svg className="pulse-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="35.2" />
    </svg>
    <Reactor />
    {current && <Leader node={current} />}
    <div role="listbox" aria-label="Fleet roster">
      {nodes.map(n => (
        <button
          key={n.id}
          role="option"
          aria-selected={selected === n.id}
          className={`node ${n.status}`}
          style={{ left: `${n.nx}%`, top: `${n.ny}%`, position: 'absolute' }}
          onClick={() => onSelect(n.id)}
          aria-label={`${n.id} ${n.role}, load ${n.load}%`}
        >
          <span className="node-ring"><StatusDot status={n.status} /></span>
          <span className="node-id">{n.id}</span>
        </button>
      ))}
    </div>
    {current && <Callout node={current} />}
  </div>
}
