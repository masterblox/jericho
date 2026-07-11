# Hermes execution protocol v1

**Owner:** Jericho Core and the Hermes operator

**Status:** active Jericho-side contract; the Hermes repository installed on
2026-07-11 implements only the legacy historical bus and is not v1-compatible.

Jericho may dispatch an approved assignment over the filesystem bus only after
the operator publishes a fresh capability handshake. Configuration alone never
makes the worker executable.

## Capability handshake

The operator atomically refreshes
`<JERICHO_HERMES_BUS_ROOT>/jericho-operator-capabilities.json`:

```json
{
  "protocol_version": 1,
  "operator_id": "hermes-jericho-operator",
  "operator_version": "1.0.0",
  "generated_at": "2026-07-11T00:00:00.000Z",
  "expires_at": "2026-07-11T00:01:00.000Z",
  "capabilities": [
    "bounded_stop",
    "idempotent_dispatch",
    "independent_verification_evidence",
    "metered_cost_evidence",
    "structured_artifacts"
  ]
}
```

The file must be a bounded regular file inside a real bus directory. The
timestamps use canonical ISO-8601 UTC. `generated_at` cannot be in the future
and `expires_at` must be later than the Jericho check. Missing, malformed,
expired, wrong-version, or incomplete handshakes set `hermes-execution` health
to `unavailable`, with `executable: false`; Jericho creates no execution
scheduler and emits no task.

The operator must declare a capability only when it enforces it. In particular,
`independent_verification_evidence` means the artifact is checked by a verifier
step independent from the worker that generated it. A worker's own success
claim is not verification.

## Task and result

The v1 outbox task retains the historical top-level fields (`id`, `created_at`,
`source`, `action`, `workspace`, `message`, `priority`, and `on_blocked`) and
adds a `jericho` descriptor containing:

- protocol, mission, task, assignment, and idempotency identities;
- immutable evidence event IDs;
- the exact approved actions, tools, writable scope, and artifact requirement.

The operator must reject scope expansion and recursive worker creation. It must
deduplicate by task ID/idempotency key and implement a bounded `stop` task for
the parent task ID.

A terminal `success` result must include the historical result fields plus:

```json
{
  "artifact": { "type": "the-approved-type", "data": {} },
  "verification": {
    "checks": ["every approved check"],
    "evidence": ["every approved evidence selector"]
  },
  "costs": [{
    "category": "model",
    "estimated_micro_usd": 500,
    "actual_micro_usd": 83,
    "provider": "local-runtime",
    "model": "local",
    "evidence": ["operator-meter:usage-1"]
  }]
}
```

Jericho binds the result to the exact mission, task, assignment, artifact type,
and approved evidence before the independent mission verifier may complete the
assignment. Legacy `in_progress` or `success` files without this data are
encrypted as `hermes.legacy_result_checkpoint` events for human review. They
remain `pending_approval` and can never become successful artifacts.

The cost estimates must sum exactly to the approved assignment estimate. Model
and tool identities must match the approved descriptor. Jericho derives cost
record IDs/idempotency keys, records the reported actual integer micro-USD, and
the mission runner pauses when the accumulated actual cost exceeds budget.
External-action assignments are rejected before dispatch: filesystem v1 does
not yet define independently verified destination receipts.

## Repository authority

Repository grants are an explicit allowlist:

```bash
JERICHO_MISSION_REPOSITORY_GRANTS='[{"repository":"jericho","writablePaths":["apps/jarvis"],"mutationClasses":["reversible"]}]'
```

A direct Carlos capture must select one configured entry in its immutable
payload:

```json
{
  "text": "Implement the approved Jericho change",
  "requiredCapabilities": ["code.repo"],
  "jerichoScope": { "repository": "jericho" }
}
```

No selector means no repository grant. An invalid or unconfigured selector is
routed to Review. The Research task receives only workspace selection with an
empty writable path/mutation set; the lane task receives the exact selected
grant. The configured `JERICHO_HERMES_REPO` must match that approved grant or
execution fails before writing an outbox task.

## Required Hermes-side upgrade

The current `bin/jericho-operator` injects a prompt into Conductor, writes only
`in_progress`, reports `stop` as unimplemented, and emits no structured artifact
or independent verification evidence. Hermes `AGENTS.md` also marks the
filesystem bus documentation as historical. Real successful execution is
therefore not possible with the installed operator.

The remaining external action is a Hermes-side implementation and deployment
of this v1 contract (or an equivalently authenticated gateway adapter),
including the expiring handshake, scope enforcement, cancellation,
idempotency, metered cost evidence, structured artifacts, and independent
verification receipts. A later protocol version is required before this bus may
perform external sends, deployments, or other actions needing destination
receipts.
After deployment, restart Jericho and verify `hermes-execution` is healthy
before approving a live mission.
