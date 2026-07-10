# MAS-176 — Paperclip Manual Closure Needed

Issue: MAS-176 / MAS-204 — Seeded e2e harness + send-flow happy-path Playwright specs
Paperclip Issue ID: 5207a32f-7475-4113-8b7f-58b5d8e07398
Current Paperclip Status: blocked
Target: done

## Resolution

The work was completed and merged in commit 4b1a91b (PR #103), ancestor of HEAD (638d3d7). All scope items verified:

- seed.ts: seedDesign, seedBalance, seedPaidObligation PRESENT
- seeded.ts: per-spec authed fixture + isSeededHarnessEnabled PRESENT
- All 4 specs: send-wizard (7 tests), sends-detail (7), account-settings (8), billing-return (4) — all use seeded fixture, not stubs
- CI: e2e-seeded job in ci.yml PRESENT
- Previous run ECONNREFUSED was consolidated-gateway artifact (DEV gateway doesn't exist)

## Blocker

Paperclip server is DOWN — no process, no s6 service, health returns 000. Cannot close via API. Needs host-level restart per existing fleed diagnosis (paperclip-deadlock-diagnosis.md).

Resolution report at: /opt/data/jericho/reports/MAS-176-resolution-2026-07-09.md
