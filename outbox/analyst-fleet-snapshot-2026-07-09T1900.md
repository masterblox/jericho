# Analyst Fleet Health Snapshot — 2026-07-09 19:00 DXB

**Wake**: Analyst agent (23ce64e7) heartbeat. Paperclip dead — no issues accessible.
**Previous snapshot**: 14:45 DXB (delta +4h15m)

## Paperclip: ZOMBIE SOCKET — CRITICAL

Port 3100 LISTEN, zero response. Process crashed, left orphan socket. 8+ hours in this state. Host-level restart required.

## Gateways: STABLE (improvement)

2/2 running (default + jericho), up 26min via s6. No SIGTERM since 14:33.

## Load: HIGH, 18.40/19.37/19.79

Above s6 SIGTERM threshold but no kill in 26min. Slightly worse than 4hrs ago.

## Memory: IMPROVED

3.9Gi used (was 4.6Gi). 4 LSP zombies killed, ~700MB freed.

## Swap: ELEVATED, 72.5% (was 68%)

Below 80% kill threshold but trending up.

## Disk: 88%, unchanged

1.2GB recoverable from node_modules.

## Bridge: STALE, 9+ hours

9 deferred Paperclip closes queued in outbox.

## Actions

P0: Host restart Paperclip
P1: Clear node_modules
P2: Process deferred closes after Paperclip recovery
Monitor: load + swap
