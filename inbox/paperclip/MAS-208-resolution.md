# MAS-208 Resolution: MAS-166 — Move /account/designs/new off GET-time row creation

**Resolved**: 2026-07-07 ~20:45 UTC
**Disposition**: done (already implemented and shipped on main)

## Summary

MAS-166 was already fully implemented across 4 commits on main before this run picked up the issue. The previous run (959dc863) failed with HTTP 429 (gateway rate limit) before it could discover this.

## Implementation on main

The work follows Option A (convert to POST server action):

1. **Server action** (`app/(authed)/account/designs/_actions.ts`): `createDesignAction(formData)` handles auth gate, workgroup resolution, template creation via tRPC, FORBIDDEN -> friendly redirect (MAS-203), and success redirect to `/account/designs/${id}`.

2. **Dashboard** (`app/(authed)/account/page.tsx`): "Start a memory" hero button uses `<form action={createDesignAction}>` with `data-testid="start-a-memory"`.

3. **Designs list** (`app/(authed)/account/designs/page.tsx`): "Start a new design" button (empty state + list header) uses the same form POST.

4. **Route deleted**: `/account/designs/new/` directory removed from main. Direct GET returns 404.

## Git evidence

Commits on main:
- `1ccfc56` — [MAS-166] test: unit-cover createDesignAction auth + workgroup gating (#79)
- `8ca3681` — [MAS-203] Member-role create CTAs: hide + surface FORBIDDEN, no 500 (#93)
- `f21476d` — [MAS-186] Bridge asset library + drag-import (#91)
- `3d239ba` — [MAS-201] fix: marketing region picker linked to removed route (#97)

## Tests

- vitest: `tests/app/designs/createDesignAction.test.ts` — 7 tests (auth gating, workgroup gating, template forwarding, FORBIDDEN handling, error boundaries)
- Playwright: `tests/e2e/designs-create.spec.ts` — 3 specs (server action redirect, dashboard CTA, legacy URL returns 404)

## No action needed

No code changes required. The issue describes work already shipped. Recommend closing MAS-208 as done.
