# Jericho runtime index

**Owner:** Jericho Core

**Freshness:** reviewed 2026-07-11; update with every contract, trust-boundary, or entry-point change.

## Entry points

| Area | Canonical start | Responsibility |
|---|---|---|
| Local service | `bridge/src/server.ts` | One loopback origin for static UI, authenticated API/SSE, voice WebSocket, and connector lifecycle. |
| Runtime composition | `bridge/src/runtime.ts` | Registers configured source connectors and durable polling supervision. |
| Private truth | `bridge/src/core/store.ts` | Encrypted SQLite records, immutable events, provenance, identities, missions, decisions, assignments, and receipts. |
| Orchestration | `bridge/src/orchestration/` | Classify, route, plan, policy-check, lease, execute, verify, and retain bounded missions. |
| Contracts | `shared/src/index.ts` | Shared envelopes and command-center projections. |
| Command center | `frontend/src/main.tsx` | React application bootstrap and local hardware engagement boundary. |
| Gesture runtime | `frontend/src/jarvis-runtime.ts` | Disposable camera/MediaPipe integration and semantic gesture dispatch. |

## Knowledge and authority map

- `bridge/src/connectors/adapters/` contains read-side truth adapters. Telegram enters only through the authenticated Hermes gateway.
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

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

## Archive rule

Do not add new runtime behavior to the deleted legacy HUD or the root `interface/` fixture app. Preserve old plans only as historical context and mark superseded assumptions in `docs/INDEX.md`.
