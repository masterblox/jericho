# Jericho documentation index

**Owner:** Carlos / Jericho Core

**Freshness:** reviewed 2026-07-11.

## Canonical active documents

| Document | Purpose | Freshness trigger |
|---|---|---|
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | System boundaries, trust model, lifecycle, and runtime topology. | Any authority, contract, connector, or execution-policy change. |
| [`../apps/jarvis/README.md`](../apps/jarvis/README.md) | Operator setup, configuration, gestures, and verification. | Any boot, configuration, UI, or gesture change. |
| [`JERICHO-V1-GESTURES.md`](JERICHO-V1-GESTURES.md) | Low-level v1 gesture invariants retained by the current runtime. | Any tracking threshold or gesture grammar change. |
| [`HERMES-EXECUTION-PROTOCOL-V1.md`](HERMES-EXECUTION-PROTOCOL-V1.md) | Fail-closed Hermes capability handshake, result, verification, cancellation, and repository-authority contract. | Any Hermes execution protocol or repository grant change. |

## Historical or superseded material

| Document | Status |
|---|---|
| `JARVIS-BUILD-PLAN.md` | Historical implementation plan; architecture and status claims may be stale. |
| `JARVIS-PARTY-TRICK-PLAN.md` | Historical visual/demo exploration; not a product or authority specification. |

When documents conflict, use `ARCHITECTURE.md`, shared TypeScript contracts, and executable tests in that order. Direct source APIs and Git remain evidence truth; documentation never authorizes external action.
