# Jarvis → Jericho repository migration record

Status: applied in this repository. Active product naming is Jericho exclusively.

## Structural outcome

- `apps/jarvis/` → `apps/jericho/`
- Root package name `jarvis` → `jericho`
- `jarvis-runtime.ts` → `jericho-runtime.ts`
- Persona mode `jarvis` → `jericho` (emitted value)
- Presentation name `JARVIS` → `JERICHO`
- Conductor setup/run/verify scripts use `apps/jericho`
- `.worktreeinclude` seeds `apps/jericho/.env` (mode `0600`)

## Allowlisted legacy literal

The historical persona value may appear only in:

1. `apps/jericho/bridge/src/personas-migration.ts` — compatibility parser
2. `apps/jericho/bridge/tests/persona-migration.test.ts` — focused fixture
3. this migration record

The parser accepts the legacy persisted mode and immediately rewrites it to
`jericho`. New storage, events, UI copy, package names, and paths must never
emit the legacy value.

## Historical external identifiers (not product code)

These names referred to external remotes or planning branches and are recorded
here so active docs no longer carry them:

- GitHub vault remote formerly known as `masterblox/jarvis-brain`
- Planning branch formerly known as `masterblox/jarvis-party-trick-plan`

They are not application paths and must not be reintroduced into active product
surfaces.
