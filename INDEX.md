# Jericho repository index

**Owner:** Carlos / Jericho Core

**Freshness:** reviewed 2026-07-11; update when authority, runtime entry points, or archive status changes.

## Start here

1. [`ARCHITECTURE.md`](ARCHITECTURE.md) — canonical system boundaries, lifecycle, trust model, and runtime topology.
2. [`apps/jarvis/INDEX.md`](apps/jarvis/INDEX.md) — active TypeScript implementation and verification commands.
3. [`docs/INDEX.md`](docs/INDEX.md) — active operator documentation and historical design material.
4. [`.conductor/settings.toml`](.conductor/settings.toml) — shared local setup, run, and verification commands.

## Material status

| Root | Status | Authority / purpose |
|---|---|---|
| `apps/jarvis/` | **Active, canonical runtime** | Local Core, shared contracts, connectors, bounded orchestration, React command center, voice, and gestures. |
| `ARCHITECTURE.md` | **Active, canonical design** | Source-of-truth boundaries and implemented lifecycle. |
| `docs/` | **Mixed; indexed** | Current operating notes plus superseded build explorations. Consult `docs/INDEX.md`. |
| `interface/` | **Design reference, not runtime** | Earlier visual prototype and Operator Bay assets. Production code must not import its fixture data. |
| `specs/`, `scripts/`, `paperclip/`, `inbox/`, `outbox/`, `reports/` | **Legacy fleet surfaces** | Reconciled inputs or historical automation; never authoritative over direct source APIs, Git, or Jericho Core. |
| `course/`, `training/`, `review/` | **Reference/archive** | Non-runtime material. |
| `state/` | **Legacy local runtime state** | Not a Jericho Core contract. New durable private state belongs in encrypted Core storage. |

## Authority rule

Direct source APIs and Git are source truth. Encrypted Jericho Core records are the canonical local projection and authority ledger. Obsidian is durable human-readable knowledge. Paperclip and filesystem buses are reconciled worker surfaces only.
