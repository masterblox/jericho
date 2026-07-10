# Engineer Ticket Registry

**Last updated:** 2026-07-06 (DEV#54–57 cleanup; .bak files archived)
**Convention:** DEV## for DEV lane, PA## for PA lane, group## for joint tickets.
Sequential, per lane. DEV#58 = next, PA#21 = next.

## DEV Tickets

| ID | Slug | Status | Filed | Resolved |
|---|---|---|---|---|
| DEV#01 | openai-model-access | CLOSED | 2026-05-27 | Codex OAuth working |
| DEV#02 | brand-canon-files | CLOSED | 2026-05-28 | V2 brand canon shipped |
| DEV#03 | codex-oauth-setup | CLOSED | 2026-05-27 | OAuth device flow working |
| DEV#04 | deploy-pitch-deck | CLOSED | 2026-05-28 | Shipped |
| DEV#05 | vellum-obsidian-stack | CLOSED | 2026-05-28 | Deprecated |
| DEV#06 | codex-oauth-device-flow | CLOSED | 2026-05-29 | Merged into DEV#03 |
| DEV#07 | fix-vision-image-reading | CLOSED | 2026-05-29 | DEV#14 codex-stream-fix baked in |
| DEV#08 | memories-express-away-mode | CLOSED | 2026-05-30 | Away plan + cron deployed |
| DEV#09 | stepfun-free-provider | PARKED | 2026-05-30 | Carlos parked StepFun |
| DEV#10 | hermes-desktop-install | CLOSED | 2026-05-30 | Done |
| DEV#11 | stepfun-pa-model | PARKED | 2026-05-31 | Carlos parked StepFun |
| DEV#12 | supergroup-migration-fix | CLOSED | 2026-05-31 | Groups deleted, irrelevant |
| DEV#13 | foxsy-qa | CLOSED | 2026-05-31 | Pipeline shipped |
| DEV#14 | social-content-pipeline-skill | CLOSED | 2026-05-31 | Skill deployed |
| DEV#15 | opencode-test | CLOSED | 2026-05-31 | Tested |
| DEV#16 | group-dm-responsiveness | CLOSED | 2026-06-01 | Groups dead, irrelevant |
| DEV#17 | delegate-task-model-override | CLOSED | 2026-06-01 | Shipped, in use |
| DEV#18 | memory-compact-emergency | CLOSED | 2026-06-03 | Fleet compression pinned |
| DEV#19 | fleet-health | CLOSED | 2026-06-03 | Image gen, repo tracking, cron all green |
| DEV#20 | iris-brand-assets-content-day | CLOSED | 2026-06-04 | Iris got brand assets + P4 content pointer |
| DEV#21 | fix-pa-persona-anti-spillage | CLOSED | 2026-06-04 | Ghost — PA persona hardened via PA#13 |
| DEV#22 | fix-root-owned-designer-files | CLOSED | 2026-06-04 | Superseded by DEV#25 |
| DEV#23 | streaming-threaded-telegram | CLOSED | 2026-06-04 | Abandoned — feature never built |
| DEV#24 | evaluate-tiptour | CLOSED | 2026-06-04 | Abandoned — TipTour never evaluated |
| DEV#25 | vault-chown | OPEN | 2026-06-04 | chown -R hermes:hermes /opt/brain |
| DEV#26 | hermes-upgrade | CLOSED | 2026-06-15 | Gateways all v0.16.0 |
| DEV#27 | client-dossier-system | CLOSED | 2026-06-15 | Yana dossier fixed, path casing, signed offer |
| DEV#28 | pa-cron-status | CLOSED | 2026-06-15 | Superseded by PA#13 cleanup |
| DEV#29 | iris-consult-bridge-smoke | CLOSED | 2026-06-15 | Bridge smoke passed |
| DEV#30 | iris-consult-bridge-smoke-2 | CLOSED | 2026-06-15 | Auth smoke passed |
| DEV#31 | — | SKIPPED | — | No ticket filed; numbering gap |
| DEV#32 | iris-foxsy-asset-path | CLOSED | 2026-06-15 | 39 PNGs synced |
| DEV#33 | update-log-audit | CLOSED | 2026-06-16 | Logs swept; gateways v0.16.0 |
| DEV#34 | playwright-meet | CLOSED | 2026-06-16 | Chromium 148 + Playwright 1.60 installed on VPS |
| DEV#35 | bridge-smoke-test | CLOSED | 2026-06-16 | Engineer saw bridge smoke ticket |
| DEV#36 | jericho01-ops-hardening | SKIPPED | 2026-06-16 | Not a Dev ticket; implemented under JERICHO#01 ops |
| DEV#37 | stop-cron-dev-spam | CLOSED | 2026-06-17 | Paused DEV Hermes cron + PA satellite |
| DEV#38 | cron-taxonomy-audit | CLOSED | 2026-06-17 | Classified Jericho/DEV, Jericho/PA, PA satellite |
| DEV#39 | glm-opencode-migration | CLOSED | 2026-06-17 | GLM/OpenCode wired and smoke-tested |
| DEV#40 | donald-sales-agent | OPEN | 2026-06-17 | Sales agent profile (WA + TG + Email + Jericho) |
| DEV#41 | cron-ownership-repair | CLOSED | 2026-06-17 | Restored DEV/PA cron registries to hermes ownership |
| DEV#42 | — | GAP | — | No ticket filed |
| DEV#43 | — | GAP | — | No ticket filed |
| DEV#44 | — | GAP | — | No ticket filed |
| DEV#45 | container-cleanup | CLOSED | 2026-06-20 | Host 80%→52%, nuked hermes-dashboard image (2.9G), freed ~300M |
| DEV#46 | memories-express-admin-motion | CLOSED | 2026-06-23 | Admin motion push shipped by engineer |
| DEV#47 | iris-runner-cron-guard | OPEN | 2026-06-25 | Iris Reply Watcher keeps getting killed by cron quiet guard |
| DEV#48 | iris-crybex-unblock | CLOSED | 2026-06-25 | Cloned jarvis-brain, extracted Crybex branding assets |
| DEV#49 | elevenlabs-tts-switch | RESOLVED (via edge) | 2026-06-25 | Dropped ElevenLabs; switched PA tts to edge (Microsoft neural, free) |
| DEV#50 | iris-visual-moa | CANCELLED | 2026-06-27 | Aborted by Carlos — not needed |
| DEV#51 | donald-skills-perms | RESOLVED | 2026-06-27 | Host-side chown on /srv/hermes/donald-data/ |
| DEV#52 | architect-studio-deslop | OPEN | 2026-06-28 | De-slop studio: real PNGs now, compute from real glTF later |
| DEV#53 | mechanica-pa | OPEN | 2026-07-01 | PA agent operational spec for Mechanica fleet |
| DEV#54 | nuke-hermes-dashboard-image | CLOSED | 2026-06-20 | Nuked dangling dashboard image (2.9G). Superseded old letter-suffixed ticket. |
| DEV#55 | container-bloat-audit | RESOLVED | 2026-06-20 | Carlos parked. Superseded old letter-suffixed ticket. |
| DEV#56 | jericho-tui-live-dashboard | OPEN | 2026-06-25 | Live agent state dashboard (fixture → real data) |
| DEV#57 | overnight-fleet-maintenance | RESOLVED | 2026-06-25 | 7-task fleet maintenance checklist. Completed. |

## PA Tickets

| ID | Slug | Status | Filed | Resolved |
|---|---|---|---|---|
| PA#01 | hermes-uid-501-fix | OPEN | 2026-05-27 | Re-filed 2026-06-04 |
| PA#02 | monday-api-setup | CLOSED | 2026-05-27 | Twenty CRM live, Monday deprecated |
| PA#03 | whatsapp-setup | OPEN | 2026-05-27 | Reactivated 2026-06-04 — Carlos wants WA bridge |
| PA#04 | stt-voice-setup | CLOSED | 2026-05-28 | Voice notes working |
| PA#05 | pa-dev-collab | CLOSED | 2026-05-28 | Superseded by group -> bridge migration |
| PA#06 | two-agent-architecture | CLOSED | 2026-05-29 | Architecture shipped |
| PA#07 | vision-routing | OPEN | 2026-06-04 | PA vision parked, needs route |
| PA#08 | dm-routing-saved-messages | OPEN | 2026-06-04 | Messages landing in Saved Messages |
| PA#09 | telegram-photo-attachments | OPEN | 2026-05-31 | PA can't see Telegram photos |
| PA#10 | telegram-session-reauth | OPEN | 2026-06-12 | Telethon session de-authorized, needs re-auth |
| PA#11 | medical-subagent | OPEN | 2026-06-15 | Medical sub-agent needed |
| PA#12 | telethon-secret-spill | CLOSED | 2026-06-02 | Health check done, secrets clean |
| PA#13 | crm-rules-cron-repair | CLOSED | 2026-06-15 | CRM rules, stale crons, vision drift all fixed |
| PA#14 | pa-satellite-cron-taxonomy | CLOSED | 2026-06-17 | Retagged satellite cron; remains paused |
| PA#15 | cron-ownership-repair | CLOSED | 2026-06-17 | Restored PA cron registry ownership |
| PA#16 | pa-vision-always-on | CLOSED | 2026-06-18 | Pinned PA fallback + vision to openai-codex/gpt-5.5 |
| PA#17 | honcho-memory-integration | OPEN | 2026-06-22 | Research Honcho API as Hermes memory backend |
| PA#18 | cron-quiet-guard-killed-inbox | CLOSED | 2026-06-22 | Quiet guard notifies on pauses; PA Inbox Cleanse re-enabled |
| PA#19 | pulseaudio-voice-setup | BLOCKED (auth only) | 2026-06-26 | Infra DONE + TTS now on free edge. Remaining: hermes meet auth |
| PA#20 | michael-terraza-audit | OPEN | 2026-06-29 | Michael promised overnight Terraza transformation; delivered only repo housekeeping |

## Group Tickets

| ID | Slug | Status | Filed | Resolved |
|---|---|---|---|---|
| group#01 | pa-dev-collab-infra | CLOSED | 2026-06-01 | Groups dead, superseded by bridge |

## Unregistered Engineer Activity

- **2026-06-26** — Engineer shipped Jericho TUI input repair. Filed under wrong DEV#49 ID. No separate ticket.
- **2026-06-27** — DEV#50 jericho-activation file exists on disk but registry slot DEV#50 was already assigned. Numbering conflict — needs renumbering.

## Summary

- **OPEN:** 17 (DEV#25, DEV#40, DEV#47, DEV#52, DEV#53, DEV#56, PA#01, PA#03, PA#07-11, PA#17, PA#19, PA#20)
- **RESOLVED:** 2 (DEV#51, DEV#55)
- **BLOCKED:** 1 (PA#19)
- **PARKED:** 2 (DEV#09, DEV#11)
- **CLOSED:** 49
- **CANCELLED:** 1 (DEV#50)
- **SKIPPED:** 2 (DEV#31, DEV#36)
- **GAP:** 3 (DEV#42-44 — never filed)
- **Next:** DEV#58, PA#21

## Rules

1. **Check this registry before filing.** Never create a duplicate.
2. **PA## for PA lane, DEV## for DEV lane.** Next PA = PA#21, next DEV = DEV#58.
3. **File naming:** `DEV##-slug.md` in outbox/engineer-messages/
4. **Update this file** after filing or when a ticket is resolved.
5. **One ticket per issue.** No duplicate IDs.

### MAS-283 — Wire voice-to-text (STT) into Architect AI platform
- **Created:** 2026-06-26
- **Project:** Forma
- **Assignee:** Michael Kirsanov
- **Priority:** High
- **Status:** Backlog
- **URL:** https://linear.app/masterblox/issue/MAS-283/wire-voice-to-text-stt-into-architect-ai-platform
- **Description:** Add STT for Portuguese architects — button + transcription → wired into commands
