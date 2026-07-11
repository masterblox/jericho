# Jericho runtime index

**Owner:** Jericho Core

**Freshness:** reviewed 2026-07-11; update with every contract, trust-boundary, or entry-point change.

## Entry points

| Area | Canonical start | Responsibility |
|---|---|---|
| Local service | `bridge/src/server.ts` | Loopback-only static UI, one-use browser bootstrap, authenticated API/SSE, voice WebSocket, and connector lifecycle. |
| Runtime composition | `bridge/src/runtime.ts` | Registers configured source connectors, fail-closed Hermes protocol health, and durable polling supervision. |
| Private truth | `bridge/src/core/store.ts` | Encrypted SQLite records, immutable events, provenance, identities, missions, decisions, assignments, and receipts. |
| Orchestration | `bridge/src/orchestration/` | Classify, route, plan, policy-check, lease, execute, verify, and retain bounded missions. |
| Contracts | `shared/src/index.ts` | Shared envelopes and command-center projections. |
| Command center | `frontend/src/main.tsx` | React application bootstrap and local hardware engagement boundary. |
| Gesture runtime | `frontend/src/jarvis-runtime.ts` | Disposable camera/MediaPipe integration and semantic gesture dispatch. |
| Local gesture assets | `frontend/public/mediapipe/` | Same-origin model, SIMD/non-SIMD WASM, and third-party notices. |

## Knowledge and authority map

- `bridge/src/connectors/adapters/` contains read-side truth adapters. Telegram enters only through the authenticated Hermes gateway.
- `bridge/src/orchestration/connector-action-executor.ts` is the exact-plan,
  receipt-bound Telegram/WhatsApp external action boundary. Gateway
  acknowledgement alone is not a completed receipt.
- `bridge/src/orchestration/hermes-filesystem-executor.ts` is the v1 execution boundary. It requires the contract in `../../docs/HERMES-EXECUTION-PROTOCOL-V1.md`; legacy results are review checkpoints, never successes.
- `bridge/src/command-center.ts` projects persisted truth; it must never fabricate activity for visual effect.
- `frontend/src/command-center-app.tsx` presents Core projections and records exact-version decisions; it is not a second database.
- `frontend/src/*controller*.ts`, `tracking.ts`, `calibration.ts`, and `hit-testing.ts` are deterministic gesture primitives.
- `frontend/public/` contains production-local visual assets. The earlier `interface/` app is not bundled.

## Run and verify

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm start
```

On macOS, first boot initializes private Core encryption and API credentials in Keychain. `JERICHO_MASTER_KEY` and `JERICHO_API_TOKEN` remain supported as explicit non-macOS/automation overrides.
Production prints a secret one-use browser bootstrap URL; opening the bare root
does not mint a session. Follow `../../docs/JERICHO-LIVE-SMOKE-TEST.md` for the
safe isolated test profile and the separate physical/operator prerequisites.

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

## Archive rule

Do not add new runtime behavior to the deleted legacy HUD or the root `interface/` fixture app. Preserve old plans only as historical context and mark superseded assumptions in `docs/INDEX.md`.
