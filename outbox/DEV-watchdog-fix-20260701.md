# DEV DISPATCH: Fix Host Watchdog Spam

## Problem
Host-level systemd watchdog (`hermes-seven-day-watchdog.timer`) sends "[Hermes watchdog] FAIL" alerts directly to Carlos every 5 minutes. He's received this for weeks. He told you to stop on Jun 30. It's still firing.

## Root Cause
The watchdog checks for 4 Docker containers:
```
hermes-gateway ✓ (exists)
hermes-pa-gateway ✗ (consolidated — doesn't exist)
hermes-designer-gateway ✗ (consolidated — doesn't exist)  
hermes-donald-gateway ✗ (consolidated — doesn't exist)
```

Fleet consolidation merged PA/Iris/Donald into the default gateway. 3 of 4 checks always fail → 3 consecutive failures → alert to Carlos every hour.

Also: alerts go to Carlos directly via DEV's bot token, bypassing Jericho. He explicitly said "Whu u show the watchdog? Should be Jericho."

## Fix
Patched script at `/opt/data/watchdog-fix/hermes-seven-day-watchdog.sh`

Two changes:
1. Container check reduced to only `hermes-gateway` (the sole remaining container)
2. Alert output routed to Jericho inbox (`/opt/data/jericho/inbox/realtime/`) instead of Carlos Telegram DM

## Deploy (Carlos runs on host)
```bash
sudo cp /opt/data/watchdog-fix/hermes-seven-day-watchdog.sh /usr/local/bin/hermes-seven-day-watchdog.sh && sudo chmod +x /usr/local/bin/hermes-seven-day-watchdog.sh && sudo systemctl restart hermes-seven-day-watchdog.timer && echo "Watchdog fixed"
```

## Verify
```bash
sudo systemctl status hermes-seven-day-watchdog.timer
sudo /usr/local/bin/hermes-seven-day-watchdog.sh; echo "exit=$?"
```
