#!/bin/bash
# Hermes restart script — upgrades gateways from v0.17.0 → v0.18.0
# Runs detached; survives parent gateway death.
set -e

NEW_VENV=/opt/data/hermes-venv
NEW_HERMES=$NEW_VENV/bin/hermes
LOG=/opt/data/logs/gateway-upgrade-$(date +%Y%m%d-%H%M%S).log

exec >"$LOG" 2>&1

echo "[$(date)] Starting gateway upgrade v0.17.0 → v0.18.0"

# 1. Kill old gateways
echo "[$(date)] Killing default gateway (PID 39864)..."
kill 39864 2>/dev/null || true
sleep 1

echo "[$(date)] Killing Jericho gateway (PID 39774)..."
kill 39774 2>/dev/null || true
sleep 2

# 2. Run fleet routing enforcement
echo "[$(date)] Running enforce-fleet-routing..."
/opt/hermes/.venv/bin/python3 /opt/data/enforce-fleet-routing.py DEV /opt/data/config.yaml || true

# 3. Start default gateway
echo "[$(date)] Starting default gateway (DEV/PA/Iris/Donald)..."
cd /opt/data
nohup setsid "$NEW_HERMES" gateway run --replace >> /opt/data/logs/gateways/default/current 2>&1 &
echo "[$(date)] Default gateway PID: $!"

# 4. Start Jericho gateway
echo "[$(date)] Starting Jericho gateway..."
nohup setsid "$NEW_HERMES" -p jericho gateway run --replace >> /opt/data/logs/gateways/jericho/current 2>&1 &
echo "[$(date)] Jericho gateway PID: $!"

echo "[$(date)] Gateway upgrade complete."
