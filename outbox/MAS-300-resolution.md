MAS-300 / MAS-313: 3D Render Pipeline — Resolution Report
===========================================================
Date: 2026-07-09
Agent: DEV (via Jericho)
Branch: dev/mas-300-3d-render-pipeline
Commit: 563982f
Repo: Mechanica-Labs/architect-ai
Status: in_review (needs Carlos approval on FAL-based approach)

Summary
-------
Built the 3D render pipeline with lighting presets for the Villa Savoye
showcase model. Used FAL AI image-to-image (same pattern as existing
/api/studio/render) rather than true 3D rendering (Three.js/Belender).

Files Changed
-------------
1. src/lib/client-pack/renders.ts (upgraded + extended)
   - generateConceptRenders: upgraded to flux/dev image-to-image
   - renderShowcaseModel(lighting): new function for day/night/dawn/dusk
   - Falls back to pre-rendered JPEGs when FAL_KEY unavailable

2. src/app/api/showcase/render/route.ts (NEW)
   - GET /api/showcase/render?lighting=day|night|dawn|dusk
   - Returns { src, lighting, fallback }
   - Rate-limited: 10 req/5min per IP

3. src/components/marketing/ArchitectRenders.tsx (upgraded)
   - 4 lighting presets: Day / Dawn / Dusk / Night
   - Live render fetch via /api/showcase/render
   - Silent fallback to pre-generated JPEGs

4. src/lib/client-pack/renders.test.ts (NEW)
   - vitest coverage: concept renders + showcase fallback paths

Approach Decision
-----------------
Chose FAL image-to-image over Three.js server-side or headless Blender:
- FAL_KEY already configured in env
- No new dependencies needed
- Same pattern as existing /api/studio/render
- True 3D rendering (Blender) requires Blender installation on VPS

PR: https://github.com/Mechanica-Labs/architect-ai/pull/new/dev/mas-300-3d-render-pipeline

Next Steps
----------
1. Carlos reviews FAL-based approach vs true 3D rendering
2. If approved: merge to main, deploy
3. If true 3D preferred: install Blender on VPS, rewrite renderShowcaseModel
   to use headless Blender with GLB + lighting rig
