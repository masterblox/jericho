#!/usr/bin/env bash
# Jericho OS — install hub (fleet board digest + delivery rules)
#
# Installs the hub-fleet-digest script and the DELIVERY rules doc. It does
# NOT create or move the Jarvis token — the digest reads it at runtime from
# $JARVIS_ENV (see hub/DELIVERY.md). No cron, no service changes.
#
# Safe to re-run. --dry-run prints without changing anything.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$here/common.sh"

parse_flags "$@"

repo="$here/../hub"
log "hub install (hub=$HUB_DIR scripts=$SCRIPTS_DIR)"

install_file "$repo/hub-fleet-digest.py" "$HUB_DIR/hub-fleet-digest.py" 0755 "hub"
install_file "$repo/DELIVERY.md"         "$SCRIPTS_DIR/DELIVERY.md"      0644 "hub"

if [ "$DRY" -eq 0 ] && [ ! -f "$JARVIS_ENV" ]; then
  warn "Jarvis env $JARVIS_ENV not found — digest will fall back to 'HUB: board not posted (token missing)' + DM copy."
  warn "Install the Jarvis bot so TELEGRAM_BOT_TOKEN is available there, or cron a DM delivery of the stdout copy."
fi

log "hub install complete. See $SCRIPTS_DIR/DELIVERY.md for delivery rules."
