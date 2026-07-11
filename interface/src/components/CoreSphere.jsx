import React from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

// The gate engine (HADAL SonarParticles) as the reactor's heart:
// instanced tetrahedrons on a Fibonacci sphere, UnrealBloom, cursor
// repulsion (inverse-square + swirl) with slow lerp return.
// Jericho adaptations: transparent renderer + screen blend (bloom-safe over
// the dark scene), no OrbitControls (manual group rotation, canvas is
// pointer-events:none), monotone state-driven color/bloom/speed.

const COUNT = 8000
const SPHERE_RADIUS = 42
const CURSOR_RADIUS = 30
const CURSOR_FORCE = 38.0
const DAMPING = 0.82
const HALF_H = 100 * Math.tan((60 / 2) * (Math.PI / 180)) // camera z=100, fov 60

const HUES = { jarvis: 0x79cdff, megatron: 0xff8a5c, alert: 0xff5c78 }

export function CoreSphere() {
  const mountRef = React.useRef(null)

  React.useEffect(() => {
    const container = mountRef.current
    if (!container) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000)
    camera.position.set(0, 0, 100)

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(1) // HADAL's biggest perf win
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 1.5, 0.4, 0.85)
    bloomPass.strength = 0.9
    bloomPass.radius = 0.3
    bloomPass.threshold = 0.1
    composer.addPass(bloomPass)

    const geometry = new THREE.TetrahedronGeometry(0.28)
    const material = new THREE.MeshBasicMaterial({ color: HUES.jarvis })
    const mesh = new THREE.InstancedMesh(geometry, material, COUNT)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    const group = new THREE.Group()
    group.add(mesh)
    scene.add(group)

    const dummy = new THREE.Object3D()
    const target = new THREE.Vector3()
    const positions = []
    const velocities = []
    const scales = []
    for (let i = 0; i < COUNT; i++) {
      positions.push(new THREE.Vector3((Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180))
      velocities.push(new THREE.Vector3())
      scales.push(0.4 + Math.random() * 1.2)
    }

    // cursor in group-local space (window-level so the HUD stays clickable)
    const mouse3D = new THREE.Vector3(9999, 9999, 0)
    const local = new THREE.Vector3()
    const onPointerMove = e => {
      const box = container.getBoundingClientRect()
      const nx = ((e.clientX - box.left) / box.width) * 2 - 1
      const ny = -((e.clientY - box.top) / box.height) * 2 + 1
      if (nx < -1.4 || nx > 1.4 || ny < -1.4 || ny > 1.4) { mouse3D.set(9999, 9999, 0); return }
      mouse3D.set(nx * HALF_H * camera.aspect, ny * HALF_H, 0)
    }
    const onPointerLeave = () => mouse3D.set(9999, 9999, 0)
    window.addEventListener('pointermove', onPointerMove)
    document.documentElement.addEventListener('pointerleave', onPointerLeave)

    const measure = () => {
      const w = Math.max(container.clientWidth, 2)
      const h = Math.max(container.clientHeight, 2)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)

    const stage = () => document.querySelector('.stage')
    let raf = 0
    let rot = 0
    let last = performance.now()

    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      const el = stage()
      const state = el?.dataset.coreState || 'idle'
      const mode = el?.dataset.mode || 'jarvis'
      const level = parseFloat(el?.style.getPropertyValue('--core-level')) || 0

      let speed = 0.1, bloom = 0.9
      if (state === 'listening') { speed = 0.18; bloom = 1.2 }
      else if (state === 'thinking') { speed = 0.42; bloom = 1.5 }
      else if (state === 'speaking') { speed = 0.14 + level * 0.2; bloom = 0.9 + level * 1.4 }
      else if (state === 'alert') { speed = 0.26; bloom = 1.7 }
      material.color.setHex(state === 'alert' ? HUES.alert : HUES[mode] || HUES.jarvis)
      bloomPass.strength = bloom
      rot += speed * dt
      group.rotation.y = rot
      group.scale.setScalar(1 + level * 0.08)

      // cursor into group-local frame (inverse Y rotation)
      local.copy(mouse3D)
      if (mouse3D.x < 9000) local.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -rot)

      for (let i = 0; i < COUNT; i++) {
        const phi = Math.acos(-1 + (2 * i) / COUNT)
        const theta = Math.sqrt(COUNT * Math.PI) * phi
        target.set(
          SPHERE_RADIUS * Math.cos(theta) * Math.sin(phi),
          SPHERE_RADIUS * Math.sin(theta) * Math.sin(phi),
          SPHERE_RADIUS * Math.cos(phi),
        )

        const p = positions[i], v = velocities[i]
        const dx = p.x - local.x, dy = p.y - local.y, dz = p.z - local.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < CURSOR_RADIUS && dist > 0.1) {
          const inv = 1 / dist
          const t = dist / CURSOR_RADIUS
          const smoothT = t * t * (3 - 2 * t)
          const force = (1 - smoothT) * CURSOR_FORCE
          const radialF = inv * force * 0.45
          const swirlF = force * 0.1
          // swirl around the view axis
          v.x += dx * radialF + (-dy * inv) * swirlF
          v.y += dy * radialF + (dx * inv) * swirlF
          v.z += dz * radialF
        }

        p.x += v.x; p.y += v.y; p.z += v.z
        v.multiplyScalar(DAMPING)

        const dispX = p.x - target.x, dispY = p.y - target.y, dispZ = p.z - target.z
        const displacement = Math.sqrt(dispX * dispX + dispY * dispY + dispZ * dispZ)
        const lerpRate = displacement > 20 ? 0.008 : displacement > 8 ? 0.025 : 0.05
        p.lerp(target, lerpRate)

        dummy.position.copy(p)
        const s = scales[i]
        dummy.scale.set(s, s, s)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      composer.render()

      if (!reduced) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    window.__jerichoSphere = { count: COUNT }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      composer.dispose()
      renderer.dispose()
      geometry.dispose()
      material.dispose()
      container.removeChild(renderer.domElement)
      delete window.__jerichoSphere
    }
  }, [])

  return <div ref={mountRef} className="core-sphere" aria-hidden="true" />
}
