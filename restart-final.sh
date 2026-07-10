#!/bin/bash
set -e
NEW=/opt/data/hermes-venv/bin/hermes
LOG=/opt/data/logs/gateway-upgrade-final-$(date +%Y%m%d-%H%M%S).log
exec >"$LOG" 2>&1
echo "[$(date)] Final upgrade pass — killing old, starting v0.18.0"

# Kill everything hermes gateway
pkill -f "hermes gateway" || true
sleep 3

# Enforce routing
/opt/hermes/.venv/bin/python3 /opt/data/enforce-fleet-routing.py DEV /opt/data/config.yaml || true

# Start default (DEV/PA/Iris/Donald)
cd /opt/data
nohup "$NEW" gateway run --replace > /opt/data/logs/gateways/default/current 2>&1 &
echo "[$(date)] Default gateway: $!"

# Start Jericho
nohup "$NEW" -p jericho gateway run --replace > /opt/data/logs/gateways/jericho/current 2>&1 &
echo "[$(date)] Jericho gateway: $!"

echo "[$(date)] Done. Both gateways on v0.18.0."
