import React from 'react'
import { agents } from '../data'
import { store } from '../jericho-api'

// Rasterized particle volume: the reactor as gravitational attractor with
// log-spiral arms, each agent node a secondary attractor with its own cluster.
// Monotone blue — brightness is the only ladder; red is reserved for degraded/alert.
// One rAF loop, typed arrays, additive 1-2px rects. No React work per frame.

const TAU = Math.PI * 2
const NODE_R = 41 // viewBox units, matches CoreAssembly ring
const ARMS = 3
const PITCH = 4.7 // 1/tan(spiral pitch)

const BUCKETS = [
  { a: 0.22 }, // dim haze
  { a: 0.45 }, // mid
  { a: 0.85 }, // bright tracers
]

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function ParticleField() {
  const canvasRef = React.useRef(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rnd = mulberry(1337)

    // ambient dust + node clusters only — the 3D CoreSphere owns the center now
    const area = window.innerWidth * window.innerHeight
    const count = Math.round(Math.min(4500, Math.max(2200, area / 300)))

    // particle storage
    const pr = new Float32Array(count)   // base radius (viewBox units)
    const pth = new Float32Array(count)  // theta
    const pom = new Float32Array(count)  // omega
    const pph = new Float32Array(count)  // breath phase
    const psz = new Float32Array(count)  // px size
    const pcl = new Int8Array(count)     // cluster index or -1
    const pbk = new Int8Array(count)     // brightness bucket

    const clusterShare = 0.12
    for (let i = 0; i < count; i++) {
      const u = rnd()
      if (i < count * clusterShare) {
        const c = i % 6
        pcl[i] = c
        pr[i] = 4.5 * rnd() * rnd() + 0.4          // tight local orbit radius
        pth[i] = rnd() * TAU
        pom[i] = (0.5 + rnd() * 0.7) / Math.sqrt(pr[i] + 0.4)
      } else {
        pcl[i] = -1
        const r = 8 * Math.pow(58 / 8, u)          // log-uniform: dense near core
        const arm = i % ARMS
        pr[i] = r
        pth[i] = (arm * TAU) / ARMS + Math.log(r / 8) * PITCH + (rnd() - 0.5) * 0.55
        pom[i] = 4.4 / Math.pow(r, 1.5)
      }
      pph[i] = rnd() * TAU
      psz[i] = rnd() < 0.75 ? 1 : 2
      const b = rnd()
      pbk[i] = b < 0.62 ? 0 : b < 0.92 ? 1 : 2
    }

    // bucket-sorted index lists so fillStyle changes are O(buckets)
    const order = Array.from({ length: count }, (_, i) => i)
      .sort((a, b) => (pcl[a] - pcl[b]) || (pbk[a] - pbk[b]))

    // geometry: track the core-wrap box
    let cx = 0, cy = 0, scale = 1
    const nodes = agents.map((a, i) => ({ status: a.status, id: a.id, ang: ((-90 + i * 60) * Math.PI) / 180, x: 0, y: 0 }))
    const dprCap = 1 // particles are 1-2px points; retina buys nothing here

    function measure() {
      canvas.width = Math.round(canvas.clientWidth * dprCap)
      canvas.height = Math.round(canvas.clientHeight * dprCap)
      ctx.setTransform(dprCap, 0, 0, dprCap, 0, 0)
      const wrap = document.querySelector('.core-wrap')
      const stageBox = canvas.getBoundingClientRect()
      if (wrap) {
        const box = wrap.getBoundingClientRect()
        cx = box.left + box.width / 2 - stageBox.left
        cy = box.top + box.height / 2 - stageBox.top
        scale = box.width / 100
      } else {
        cx = canvas.clientWidth / 2; cy = canvas.clientHeight / 2
        scale = Math.min(canvas.clientWidth, canvas.clientHeight) / 100
      }
      for (const n of nodes) {
        n.x = cx + NODE_R * scale * Math.cos(n.ang)
        n.y = cy + NODE_R * scale * Math.sin(n.ang)
      }
    }
    measure()
    window.addEventListener('resize', measure)

    const stage = () => document.querySelector('.stage')
    window.__jerichoParticles = { count }

    const BLUE = '121, 205, 255'
    const RED = '255, 92, 120'
    const ORANGE = '255, 138, 92'

    let raf = 0
    let last = performance.now()
    let frame = 0
    let lvl = 0 // smoothed level

    function draw(now) {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      frame++
      if (frame % 90 === 0) measure()

      const el = stage()
      const state = el?.dataset.coreState || 'idle'
      const mode = el?.dataset.mode || 'jarvis'
      const level = parseFloat(el?.style.getPropertyValue('--core-level')) || 0
      lvl += (level - lvl) * 0.12
      const t = now / 1000

      let speedM = 1, briM = 1
      if (state === 'listening') { speedM = 1.15; briM = 1.25 }
      else if (state === 'thinking') { speedM = 2.2; briM = 1.15 }
      else if (state === 'speaking') { speedM = 1 + lvl * 1.2; briM = 0.9 + lvl * 0.9 }
      else if (state === 'alert') { speedM = 1.35; briM = 1.25 }

      const baseHue = state === 'alert' ? RED : mode === 'megatron' ? ORANGE : BLUE
      const selected = store.getSnapshot().selectedAgent
      const shards = state === 'alert' // alarm changes the particle SHAPE, not the motion

      // precompute every fill style once per frame — zero string work in the hot loop
      const coreStyle = BUCKETS.map(b => `rgba(${baseHue},${Math.min(1, b.a * briM).toFixed(2)})`)
      const clusterStyle = nodes.map(n => {
        let hue = baseHue, mul = 1
        if (state !== 'alert') {
          if (n.status === 'degraded') hue = RED
          else if (n.status === 'paused') mul = 0.4
        }
        if (selected === n.id) mul *= 1.6
        return BUCKETS.map(b => `rgba(${hue},${Math.min(1, b.a * briM * mul).toFixed(2)})`)
      })

      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
      ctx.globalCompositeOperation = 'lighter'

      const breathe = 1 + 0.03 * Math.sin(t * 0.4)
      const selPulse = 1 + 0.08 * Math.sin(t * 3)
      let curStyle = null
      for (let oi = 0; oi < count; oi++) {
        const i = order[oi]
        pth[i] += pom[i] * speedM * dt

        let x, y
        const c = pcl[i]
        const style = c >= 0 ? clusterStyle[c][pbk[i]] : coreStyle[pbk[i]]
        if (style !== curStyle) { ctx.fillStyle = style; curStyle = style }

        if (c >= 0) {
          const n = nodes[c]
          const rho = pr[i] * scale * (selected === n.id ? selPulse : 1)
          x = n.x + rho * Math.cos(pth[i])
          y = n.y + rho * 0.65 * Math.sin(pth[i])
        } else {
          const r = pr[i] * breathe * scale
          x = cx + r * Math.cos(pth[i])
          y = cy + r * Math.sin(pth[i])
        }
        if (shards) {
          // cross shards instead of points
          const s = psz[i]
          ctx.fillRect(x - s, y, s * 3, 1)
          ctx.fillRect(x, y - s, 1, s * 3)
        } else {
          ctx.fillRect(x, y, psz[i], psz[i])
        }
      }

      // energy link: core -> selected node with calibration ticks (ported from realistic-hud)
      const sel = nodes.find(n => n.id === selected)
      if (sel) {
        const hue = state === 'alert' || sel.status === 'degraded' ? RED : baseHue
        ctx.lineWidth = 1
        ctx.strokeStyle = `rgba(${hue},0.45)`
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sel.x, sel.y); ctx.stroke()
        const d = Math.hypot(sel.x - cx, sel.y - cy) || 1
        const px = -(sel.y - cy) / d, py = (sel.x - cx) / d
        ctx.strokeStyle = `rgba(${hue},0.28)`
        for (let k = 1; k < 8; k++) {
          const f = k / 8
          const tx = cx + (sel.x - cx) * f, ty = cy + (sel.y - cy) * f
          ctx.beginPath()
          ctx.moveTo(tx - px * 3, ty - py * 3)
          ctx.lineTo(tx + px * 3, ty + py * 3)
          ctx.stroke()
        }
      }

      raf = requestAnimationFrame(draw)
    }

    if (reduced) {
      // single static frame, no loop
      draw(performance.now())
      cancelAnimationFrame(raf)
    } else {
      raf = requestAnimationFrame(draw)
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      delete window.__jerichoParticles
    }
  }, [])

  return <canvas ref={canvasRef} className="particle-field" aria-hidden="true" />
}
