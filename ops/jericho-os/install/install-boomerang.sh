#!/usr/bin/env bash
# Jericho OS — install boomerang (inbound bus)
#
# Installs: receiver (github-webhook.py) + systemd unit, emit.py (bus),
# conductor poller + host cron, tier-1 event scripts, env templates.
#
# Safe to re-run. Backup-first. --dry-run prints without changing anything.
#
# A rebuild needs the SECRET and the CONDUCTOR key, which this installer
# deliberately does NOT create (PUBLIC repo, never store credentials):
#   * webhook secret  -> $BOOMERANG_ROOT/.github_secret  (0600 root)
#   * conductor key   -> $CONDUCTOR_ENV_LOADER  (see load_conductor_env.sh.example)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$here/common.sh"

parse_flags "$@"

repo="$here/../boomerang"
CONDUCTOR_ENV_LOADER="${CONDUCTOR_ENV_LOADER:-/srv/hermes/data/scripts/load_conductor_env.sh}"

log "boomerang install (root=$BOOMERANG_ROOT scripts=$SCRIPTS_DIR state=$STATE_DIR)"
log "dry-run=$DRY"

# ── 0. preconditions -------------------------------------------------------
[ -f "$repo/github-webhook.py" ] || die "missing $repo/github-webhook.py"
if [ "$DRY" -eq 0 ] && [ ! -f "$BOOMERANG_ROOT/.github_secret" ]; then
  warn "webhook secret missing at $BOOMERANG_ROOT/.github_secret — receiver will 401 every call."
  warn "Create it (0600 root) before starting the unit:  printf '%s' '<secret>' > $BOOMERANG_ROOT/.github_secret"
fi
if [ "$DRY" -eq 0 ] && [ ! -f "$CONDUCTOR_ENV_LOADER" ]; then
  warn "conductor env loader missing at $CONDUCTOR_ENV_LOADER — poller cannot fetch."
  warn "Copy $repo/load_conductor_env.sh.example to it, set CONDUCTOR_API_KEY (0600 root)."
fi

# ── 1. transport scripts + bus dir -----------------------------------------
mkdir_if_missing() { [ -d "$1" ] || { log "mkdir: $1"; [ "$DRY" -eq 0 ] && mkdir -p "$1"; }; }
mkdir_if_missing "$BOOMERANG_ROOT"
install_file "$repo/emit.py"                    "$BOOMERANG_ROOT/emit.py"                  0755 "boomerang"
install_file "$repo/github-webhook.py"          "$BOOMERANG_ROOT/github-webhook.py"        0755 "boomerang"
install_file "$repo/conductor-poller.py"        "$BOOMERANG_ROOT/conductor-poller.py"      0755 "boomerang"
# env template rides along so a rebuild operator can fill the key by hand
install_file "$repo/load_conductor_env.sh.example" "$SCRIPTS_DIR/load_conductor_env.sh.example" 0600 "boomerang"

# ── 2. tier-1 event scripts (into the DEV profile scripts dir) ---------------
install_file "$repo/boomerang-finished-digest.py"      "$SCRIPTS_DIR/boomerang-finished-digest.py"      0755 "boomerang"
install_file "$repo/boomerang-pending-completions.py"  "$SCRIPTS_DIR/boomerang-pending-completions.py"  0755 "boomerang"
install_file "$repo/boomerang-mark-event.py"           "$SCRIPTS_DIR/boomerang-mark-event.py"           0755 "boomerang"

# ── 3. systemd receiver unit (host) ------------------------------------------
require_host
unit="/etc/systemd/system/github-webhook.service"
unit_content="$(render_template "$repo/github-webhook.service")"
install_host_content "$unit" "$unit_content" 0644 "boomerang"
if [ "$DRY" -eq 0 ]; then
  host "systemctl daemon-reload || true"
fi
log "unit installed: $unit (enable: systemctl enable github-webhook; start: systemctl start github-webhook)"

# ── 4. poller host cron -------------------------------------------------------
cron_content="# Jericho OS — Conductor cloud poller (boomerang transport). Every 3 min, root.
# Reads CONDUCTOR_API_KEY at runtime via load_conductor_env.sh (never stored here).
*/3 * * * * root /usr/bin/python3 \"$BOOMERANG_ROOT/conductor-poller.py\" >> \"$BOOMERANG_ROOT/conductor-poller.log\" 2>&1"
install_cron "boomerang-conductor" "$cron_content"

# ── 5. optional caddy route (default OFF — touches the live vhost) -----------
if [ "${WITH_CADDY:-0}" = "1" ]; then
  warn "WITH_CADDY=1: adding the /webhooks/dev/github route to the live Caddyfile + reload."
  cf=/etc/caddy/Caddyfile
  require_host
  if host "grep -q '/webhooks/dev/github' '$cf'"; then
    log "caddy route already present: $cf"
  else
    add_route="$BOOMERANG_ROOT/add-caddy-route.py"
    install_file "$repo/add-caddy-route.py" "$add_route" 0755 "boomerang"
    backup_host "$cf" "boomerang"
    if [ "$DRY" -eq 0 ]; then
      host "python3 '$add_route' '$cf'"
      host "caddy validate --config '$cf' && systemctl reload caddy || echo 'caddy reload failed — validate manually'"
    fi
  fi
else
  log "caddy route NOT touched (set WITH_CADDY=1 to apply). See boomerang/caddy-route.md."
fi

log "boomerang install complete. Rebuild next: install/install-continuation.sh"
