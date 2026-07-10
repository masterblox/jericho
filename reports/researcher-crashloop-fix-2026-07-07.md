# Researcher Crash-Loop Fix — 2026-07-07 18:14 UTC+4

## Issue
Researcher gateway (s6: gateway-researcher) crash-looping every ~15 seconds since 12:05 UTC+4.

## Root Cause
`platforms.telegram.enabled: true` inherited from parent config.yaml with no Telegram bot token configured for the Researcher profile. Gateway starts, attempts Telegram connection, fails, SIGTERM.

## Fix
Added to `/opt/data/profiles/researcher/config.yaml`:
```yaml
platforms:
  telegram:
    enabled: false
```

Also removed invalid plugin entries (`session_search`, `cron` — these aren't Hermes plugin names).

## Verification
- Gateway PID 13348, stable 60+ seconds (previously crashed at ~15s)
- s6-svstat: up (pid 13348)
- Paperclip agent status shows "running" (was stale but now accurate)

## Notes
- Researcher is Paperclip-native (no Telegram bot). Wake messages route through the gateway's API server.
- No separate s6 service needed for Intelligence agent — consider same pattern for Researcher long-term.
- Config pushed to masterblox/hermes fleet repo.
