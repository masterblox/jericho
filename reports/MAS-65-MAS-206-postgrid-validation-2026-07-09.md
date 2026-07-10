# MAS-206 / MAS-65 — PostGrid Live-Account Validation: Completion Report

Date: 2026-07-09
Agent: Jericho (handling DEV wake, consolidated gateway)
PR: https://github.com/Mechanica-Labs/memories-express-mvp-cp/pull/212

## TL;DR

PR #95 (2026-06-02, commit 195212d) already did the first real test-mode run. The contract was verified. The only remaining MAS-206 work was stale comment cleanup — done in PR #212.

## Audit Findings

### Already Done (PR #95)

1. First real test-mode run executed (GHA run 26794339867)
2. Three contract drifts fixed:
   - Progression model off-by-one (postcard created at `ready`, advances through 3 targets)
   - cancelPostcard "too late" shape (422 with `cancel_failed_error` type, not literal "too late")
   - e2e teardown dropped promo_redemption reference
3. Self-delivered signed webhooks since CI can't be reached from internet
4. 4-stage sequence confirmed: `ready → printing → processed_for_delivery → completed`

### Delivery-Failure Path: Decided

PostGrid does NOT expose `returned_to_sender` or `failed` status in its postcard lifecycle enum. The enum is only: `ready, printing, processed_for_delivery, completed, cancelled`. The `print_error` column on `obligation` exists but is only set by the cancel-too-late path (orders.cancel), not by the webhook handler. This was intentionally done and documented in `docs/observability/postgrid-e2e.md`.

No action needed — field is intentionally dead for webhook-driven failures.

### Secrets: Blocked

None of `POSTGRID_API_KEY`, `POSTGRID_WEBHOOK_SECRET`, or `POSTGRID_FROM_ADDRESS_ID` are present in the VPS environment. The e2e workflow skips green without them. This is Michael's domain (owner-only per the issue scope). The secrets need to be provisioned in:
- Vercel preview env vars
- GHA `_STAGING` secrets

### Back-Template: Not Provisioned

`POSTGRID_BACK_TEMPLATE_ID` is `null` in `lib/config/printing.ts` — falls back to blank HTML. Yana would provision this via the PostGrid dashboard.

## Changes Made (PR #212)

5 files updated, removing stale "BLOCKED", "unverified", "5 stages", and "VERIFY" comments:

| File | Change |
|---|---|
| `tests/e2e/postgrid-lifecycle.spec.ts` | Removed BLOCKED block; 5→4 stages; advance ×5→×4 |
| `docs/observability/postgrid-e2e.md` | five→four lifecycle stages; "Still pending"→"Verified" |
| `docs/observability/postgrid-api-reference.md` | "Still requires live test account"→"Verified against live test account" |
| `lib/services/postgrid/postcards.ts` | "VERIFY split semantics at MAS-196"→"Confirmed against live PostGrid" |
| `lib/config/printing.ts` | "VERIFY against PostGrid docs"→"Confirmed against PostGrid docs" |

## Cannot Push (Workflow Scope)

`.github/workflows/postgrid-e2e.yml` line 16 has the same stale "BLOCKED on a live PostGrid test account" comment. The push token lacks `workflow` scope. Needs a token with workflow scope or manual edit.

## Remaining MAS-206 Scope

| Item | Status | Owner |
|---|---|---|
| Provision POSTGRID_API_KEY | NOT DONE | Michael |
| Provision POSTGRID_WEBHOOK_SECRET | NOT DONE | Michael |
| Provision POSTGRID_FROM_ADDRESS_ID | NOT DONE | Michael |
| Back-template ID | NOT DONE | Yana |
| First real run | DONE (PR #95) | — |
| Confirm field names/signature | DONE (PR #95) | — |
| Delivery-failure path decision | DONE (documented, intentionally dead) | — |
| Stale comments removed | DONE (PR #212) | — |
| Workflow file stale comment | BLOCKED (workflow scope token) | — |

## Disposition

`blocked` — on secrets provisioning (Michael) and workflow-scope token for the last stale comment. All code/doc work that Jericho can do is complete.
