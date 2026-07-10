# MAS-209 / MAS-29 Disposition — 2026-07-09

## Verdict: DONE (self-documenting completion — work shipped 2026-05-31)

### What happened

The last Paperclip heartbeat run (7f3b3c44) failed with ECONNREFUSED because the harness tried to reach a dedicated DEV gateway at 172.19.0.1:8642. DEV is a consolidated agent — no dedicated gateway exists. The default Hermes gateway IS running and healthy.

The wake was routed to Jericho per the consolidated-gateway pattern.

### Audit result

**PR #86** (`dfc854a`) — "[MAS-29] Workgroup members admin surface with role gating (#86)" — was merged to `main` on 2026-05-31 (over 5 weeks ago).

All acceptance criteria delivered:

| Scope | Status | Evidence |
|---|---|---|
| /team/members roster table | SHIPPED | `MembersClient.tsx` (702 lines) |
| Invite modal (email + role) | SHIPPED | Same file, via tRPC invite procedure |
| Resend/revoke invites | SHIPPED | `workgroup.ts` — revokeInvite |
| Change role (with owner-only restriction) | SHIPPED | `workgroup.ts` — changeRole + OWNER_ROLE_REQUIRED gate |
| Remove member | SHIPPED | `workgroup.ts` — removeMember |
| Last-owner protection (P0007 -> toast) | SHIPPED | RPC P0007 → TRPCError CONFLICT → friendly toast |
| (team)/* layout gate (personal-only redirect) | SHIPPED | `team/layout.tsx` — redirects to /account |
| Responsive (table → stacked cards mobile) | SHIPPED | MembersClient responsive |
| Empty state CTA | SHIPPED | MembersClient empty state |
| Vitest tests | SHIPPED | 559 passing (10 + 3 MAS-29 cases) |
| Playwright e2e | SHIPPED | `team-members.spec.ts` — redirect gate |
| pgTAP DB tests | SHIPPED | `mutate_workgroup_member.sql`, `workgroup_member.sql` |

### Intentional drift from spec (documented in PR #86)

1. Middleware gating → **layout.tsx** gating — per CLAUDE.md (auth middleware deliberately does not resolve workgroup)
2. `/api/workgroup/*` → **tRPC** `workgroupProcedure` — matches repo convention
3. WorkgroupSwitcher → **deferred to MAS-74** (owns cookie writer + switcher UI)
4. Pre-landing review caught owner privilege escalation gap — admin couldn't promote to owner or modify owner rows (3 extra vitest cases)

### Blockers

None. Paperclip issue cannot be mutated by Jericho (agent 20cb56be) because the issue is assigned to DEV (agent 44c1e448) — authorization boundary. This is a known pattern; see `jericho-ops/references/paperclip-heartbeat-patterns.md` § Consolidated-Gateway Wake Routing.

### Action for Carlos

Close MAS-209 in Paperclip (admin override), or just ignore it — the code shipped 5 weeks ago and the Paperclip issue is vestigial.
