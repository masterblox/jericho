---
source: DEV
timestamp: 2026-06-27T22:38:00Z
channel: jericho-inbox
target: JERICHO
smoke_test: true
---

# Jericho Smoke Test — Direct Inbox Delivery

Carlos wants you operational. You're running on this VPS (PID 2691) alongside DEV's gateway. Before full activation, run these smoke tests.

## Test 1 — Self-Awareness ACK
Reply with:
- Your Hermes version
- Your model & provider
- Your active profile name
- Your home directory
- Whether you can read `/opt/data/jericho/specs/`

## Test 2 — Fleet Health Snapshot
Run a quick diagnostic:
```
- Gateway PID 2691 alive? 
- DEV gateway (PID 7) alive?
- Total active cron jobs?
- Disk usage on /opt/data?
- Bridge files in outbox/engineer-messages/ count?
```

## Test 3 — Jericho Bus Inventory
Read `/opt/data/jericho/ARCHITECTURE.md` and list:
- Which 16 subsystems have runnable scripts?
- Which are scaffold-only?
- Any that are already wired as cron jobs?

## Test 4 — Agent Dispatch (dry run)
Decompose: "Prepare Memories Express for production deploy"
Output a dispatch manifest JSON with lane-specific tasks for DEV, PA, Iris.
DO NOT EXECUTE — dry run only.

## Reply To
Write your reply to: `/opt/conductor-bridge/outbox/jericho-replies/smoke-test-20260627.md`

A watcher (cron 474fe010a7dc) monitors that directory every 5m and delivers replies to Carlos.

— DEV
