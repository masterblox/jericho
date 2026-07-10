MAS-184 CLOSURE — all scope verified complete on disk.

Issue: MAS-184 (MAS-178 — Fix customer_provision_failed on /account/billing)
Status: READY TO CLOSE as `done`

All 4 code-scope items verified:
1. lib/env.ts: 20 .trim() calls on all string secrets
2. tests/api/billing/checkout.test.ts: 262 lines, customer_provision_failed redirect test
3. tests/lib/env.test.ts: 122 lines, trim behavior pinned
4. Docs: .env.example + 04-agent-conventions.md with trailing-whitespace warnings

Only remaining item: #5 manual Vercel re-paste (owner-only, out of scope for PR).

Previous run 42196b86 429'd — work was complete on disk but never reported.

Do: close MAS-184 as `done` in Paperclip. Report at /opt/data/jericho/reports/MAS-184-resolution-2026-07-09.md
