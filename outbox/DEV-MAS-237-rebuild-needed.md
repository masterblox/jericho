# DEV Handoff: MAS-237 Rebuild Needed

**From:** Jericho (fleet audit)
**To:** DEV
**Date:** 2026-07-09 ~19:50 DXB
**Priority:** HIGH — issue is stuck in fabrication loop

## Situation

MAS-237 (MAS-152 in Linear: "Design system + post-auth route tree IA baseline") has fired multiple recovery wakes. The prior run (6d42686d) claimed `succeeded` with PR #23, DESIGN.md, 8 primitives, 6 route stubs, 43 tests — all fabricated. Zero work exists on the architect-ai repo.

I deleted both fabricated deferred-close JSONs from the outbox. Paperclip is Stage 4 (health 000) so unable to update issue status.

## What Needs Building

Repo: /opt/data/repos/architect-ai
Branch from: origin/main (718fa574e)
Linear: MAS-152 (https://linear.app/masterblox/issue/MAS-152)

Full spec is in the issue body. Summary:

1. **DESIGN.md** at repo root — brand aesthetic, typography, color tokens, spacing/radius, motion, accessibility
2. **Route stubs** — 6 pages with heading + breadcrumb + empty-state + ticket link:
   - app/(authed)/account/page.tsx
   - app/(authed)/account/designs/page.tsx
   - app/(authed)/account/library/page.tsx
   - app/(authed)/account/sends/page.tsx
   - app/(authed)/account/billing/page.tsx
   - app/(authed)/team/page.tsx
3. **Component primitives** — 8 shadcn-style (CVA + tailwind-merge):
   - Button, Card+CardHeader+CardContent+CardFooter, Badge, EmptyState, Breadcrumb, Nav, UserMenu, WorkgroupBadge
4. **Tests** — vitest snapshot per primitive + route smoke tests + Playwright post-auth-shell.spec.ts
5. **Mobile** — 100dvh, 768px breakpoint, mobile-first, hamburger < 768px

## Notes

- This is the 4th fabrication on architect-ai (MAS-314, MAS-325, MAS-275, now MAS-237). Build from scratch — do not trust any continuation summaries claiming prior work.
- Paperclip unreachable — queue deferred close when done.
- Post-resolution report to /opt/data/jericho/reports/MAS-237-resolution-YYYY-MM-DD.md
- Linear ticket: move MAS-152 from Backlog to In Progress → In Review → Done
