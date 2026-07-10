# MAS-217 Resolution — 2026-07-09

## Verdict: DONE (code shipped; Paperclip API unreachable for status update)

## What happened

The previous run (`5b2662aa`) failed with `hermes_gateway_rate_limited` (HTTP 429) — a transient Paperclip API rate limit that prevented the heartbeat from updating the issue. The wake retry landed at 2026-07-09 ~10:41 UTC.

## Investigation

Full code audit of the MAS-53 deliverable in `/opt/data/memories-express-mvp-cp`:

### Handler: `lib/services/jobs/sendObligation.ts` (394 lines)
- Single-flight gate: `UPDATE obligation SET fulfilled=true WHERE fulfilled=false RETURNING`
- Printed variant: enqueues `generate_print_asset` before flip
- Digital variant: loads addressees → flips → delivers per-recipient
- Re-mints 48-hex tokens at send time (defense-in-depth)
- Per-recipient failure isolation (one bad address doesn't strand others)
- Canceled obligation guard (read + flip both block `canceled_at` rows)
- Idempotent: second run matches 0 rows, exits silently

### Tests: `tests/lib/services/jobs/sendObligation.test.ts` (634 lines, 13 cases)
All edge cases covered: single/multi addressee, idempotency, 0-row guard, printed variant, letter variant, alt-text fallback, per-recipient failure, partial failure, canceled guard, pre-flip failure, provider-constructor failure, obligation_id resolution, missing obligation_id error.

### Email templates
- `lib/services/email/templates/capsule-delivered.tsx` — "A memory has arrived"
- `lib/services/email/templates/letter-delivered.tsx` — "You've received a letter"
- `lib/services/email/templates/_shared/layout.tsx` — shared DeliveryEmailLayout

### Wiring
- Registered in `lib/services/jobs/handlers.ts`: `send_obligation: sendObligation`
- Dispatcher in `lib/services/jobs/dispatcher.ts` invokes via claim_scheduled_jobs RPC
- Token hashing uses `hashToken` from `lib/services/recipientView/lookup.ts` (sha256 match)

## Git evidence

```
8edbf1d [MAS-53] send_obligation handler: deliver digital capsules/letters at schedule
8f4a81d Send flow end-to-end: orders, wizard, fulfillment, PostGrid + infra (15 MAS) (#90)
```

MAS-53 shipped as part of PR #90 ("Send flow end-to-end") which merged 15 MAS tickets including this one. Commit is on `origin/main`. No open branches.

## Paperclip status

Issue `04cc998d-001d-44ed-94e0-c4deb6e7e23f` (MAS-217) cannot be updated via API:
- Health endpoint: 200 OK
- GET /api/issues/{id}: hangs → empty response (socket accept + recv hang)
- PATCH /api/issues/{id}: HTTP 000 after 15s timeout
- This matches known Paperclip degradation pattern (server process died, zombie socket on port 3100)

Issue should be marked `done` once Paperclip is restored. No code changes needed.
