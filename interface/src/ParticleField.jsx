import React from 'react'

/**
 * Jericho Particle Field — 2D canvas, vanilla JS, no dependencies.
 * Fleet core at center = gravitational attractor. Agent nodes = secondary attractors.
 * Particle color follows status: cyan=online, amber=paused, red=degraded.
 * Additive blending, 1-2px points. Targets 60fps on 2020 MacBook.
 */
export function ParticleField({ agents, selectedAgent }) {
  const canvasRef = React.useRef(null)
  const rafRef = React.useRef(0)
  const particlesRef = React.useRef([])
  const mouseRef = React.useRef({ x: 0, y: 0, active: false })

  const nodePositions = React.useMemo(() => ({
    DEV:      [0.35, 0.32],
    PA:       [0.39, 0.61],
    IRIS:     [0.65, 0.32],
    ANALYST:  [0.51, 0.46],
    RESEARCH: [0.65, 0.61],
    INTEL:    [0.82, 0.47],
  }), [])

  const corePos = React.useMemo(() => [0.50, 0.48], [])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    let w = 0, h = 0, dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const isMobile = w < 760
    const COUNT = isMobile ? 2000 : 8000
    const particles = []

    const COLORS = {
      core:     [120, 244, 246],
      online:   [120, 244, 246],
      paused:   [244, 183, 92],
      degraded: [255, 66, 103],
      background: [80, 160, 170],
    }

    for (let i = 0; i < COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random()
      const isCore = dist < 0.55
      const agentKeys = Object.keys(nodePositions)
      const agentKey = isCore ? null : agentKeys[Math.floor(Math.random() * agentKeys.length)]
      const agent = agents.find(a => a.id === agentKey)
      const colorKey = agent ? agent.status : 'core'

      let px, py
      if (isCore) {
        const spiralAngle = angle + dist * 4.5
        const r = dist * 0.22 * Math.min(w, h)
        px = w * corePos[0] + Math.cos(spiralAngle) * r
        py = h * corePos[1] + Math.sin(spiralAngle) * r
      } else {
        const node = nodePositions[agentKey]
        const r = (0.5 + dist * 0.5) * 40 + Math.random() * 30
        px = w * node[0] + Math.cos(angle) * r
        py = h * node[1] + Math.sin(angle) * r
      }

      particles.push({
        x: px, y: py,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: 0.8 + Math.random() * 1.2,
        color: COLORS[colorKey] || COLORS.core,
        isCore, agentKey,
        orbitAngle: angle,
        orbitSpeed: 0.0003 + Math.random() * 0.0008,
        orbitRadius: dist,
        life: Math.random(),
      })
    }
    particlesRef.current = particles

    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        active: true,
      }
    }
    const onMouseLeave = () => { mouseRef.current.active = false }
    canvas.addEventListener('pointermove', onMouseMove)
    canvas.addEventListener('pointerleave', onMouseLeave)

    const animate = () => {
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'

      const mouse = mouseRef.current
      const parallaxX = mouse.active ? (mouse.x - 0.5) * 6 : 0
      const parallaxY = mouse.active ? (mouse.y - 0.5) * 6 : 0

      const cx = w * corePos[0] + parallaxX
      const cy = h * corePos[1] + parallaxY

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const [r, g, b] = p.color

        if (p.isCore) {
          p.orbitAngle += p.orbitSpeed
          const targetR = p.orbitRadius * 0.22 * Math.min(w, h)
          const spiralTwist = p.orbitRadius * 3.5
          const ang = p.orbitAngle + spiralTwist
          const tx = cx + Math.cos(ang) * targetR
          const ty = cy + Math.sin(ang) * targetR
          p.x += (tx - p.x) * 0.02
          p.y += (ty - p.y) * 0.02
        } else {
          const node = nodePositions[p.agentKey]
          if (node) {
            const nx = w * node[0] + parallaxX * 0.5
            const ny = h * node[1] + parallaxY * 0.5
            p.orbitAngle += p.orbitSpeed * 1.5
            const r = 25 + p.orbitRadius * 30
            const tx = nx + Math.cos(p.orbitAngle) * r
            const ty = ny + Math.sin(p.orbitAngle) * r
            p.x += (tx - p.x) * 0.025
            p.y += (ty - p.y) * 0.025
          }
        }

        p.life += 0.01
        const twinkle = 0.6 + Math.sin(p.life * 3) * 0.4
        const alpha = twinkle * (p.isCore ? 0.7 : 0.5)

        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')'
        ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size)
      }

      // Connection lines from selected agent to core
      if (selectedAgent && nodePositions[selectedAgent]) {
        const node = nodePositions[selectedAgent]
        const nx = w * node[0] + parallaxX * 0.5
        const ny = h * node[1] + parallaxY * 0.5
        const agent = agents.find(a => a.id === selectedAgent)
        const lc = agent ? COLORS[agent.status] : COLORS.core
        ctx.strokeStyle = 'rgba(' + lc[0] + ',' + lc[1] + ',' + lc[2] + ',0.12)'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(nx, ny)
        ctx.stroke()

        const ticks = 8
        ctx.strokeStyle = 'rgba(' + lc[0] + ',' + lc[1] + ',' + lc[2] + ',0.3)'
        for (let t = 1; t < ticks; t++) {
          const f = t / ticks
          const tx = cx + (nx - cx) * f
          const ty = cy + (ny - cy) * f
          const d = Math.hypot(nx - cx, ny - cy)
          const perpX = -(ny - cy) / d
          const perpY = (nx - cx) / d
          ctx.beginPath()
          ctx.moveTo(tx - perpX * 3, ty - perpY * 3)
          ctx.lineTo(tx + perpX * 3, ty + perpY * 3)
          ctx.stroke()
        }
      }

      ctx.globalCompositeOperation = 'source-over'
      rafRef.current = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointermove', onMouseMove)
      canvas.removeEventListener('pointerleave', onMouseLeave)
    }
  }, [agents, selectedAgent, nodePositions, corePos])

  return <canvas ref={canvasRef} className="particle-canvas" aria-hidden="true" />
}
