#!/usr/bin/env bash
# Jericho OS — shared installer helpers (common.sh)
#
# Sourced by each install-*.sh. Provides:
#   * --dry-run flag handling (DRY=1: print, change nothing)
#   * idempotent, backup-first file install (ssh host aware for /etc + systemd)
#   * path configuration via env with canonical live defaults
#
# Convention: every installer is SAFE TO RE-RUN. Existing files are preserved;
# overwrites are preceded by a timestamped .bak-<reason>-<UTC> copy. Secrets
# are never written by an installer — env templates only.
set -euo pipefail

# ── global flag ------------------------------------------------------------
DRY=0

# Canonical live paths (override via env when rebuilding elsewhere)
JERICHO_ROOT="${JERICHO_ROOT:-/srv/hermes/data}"
BOOMERANG_ROOT="${BOOMERANG_ROOT:-/srv/hermes/data/boomerang}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/srv/hermes/data/profiles/dev/scripts}"
STATE_DIR="${STATE_DIR:-/opt/data/profiles/dev/state}"
HUB_DIR="${HUB_DIR:-/srv/hermes/data/profiles/dev}"
JARVIS_ENV="${JARVIS_ENV:-/srv/hermes/jarvis-botmode-data/.env}"
PI_SPOOL="${PI_SPOOL:-/srv/hermes/data/pi-requests}"

log()  { printf 'jericho-os-install: %s\n' "$*"; }
warn() { printf 'jericho-os-install: WARNING: %s\n' "$*" >&2; }
die()  { printf 'jericho-os-install: FATAL: %s\n' "$*" >&2; exit 2; }

usage_common() {
  cat <<'EOF'
Options:
  --dry-run      print what the installer would do, change nothing
  --yes          (implied in non-interactive runs) do not prompt
EOF
}

# Parse global flags; leaves unknown args in "$@" for the caller.
parse_flags() {
  out=()
  for a in "$@"; do
    case "$a" in
      --dry-run) DRY=1 ;;
      *) out+=("$a") ;;
    esac
  done
  set -- "${out[@]}"
}

# ── host (ssh host) aware helpers -------------------------------------------
# The host root shell runs as root@127.0.0.1 (key at /opt/data/.ssh/id_ed25519,
# alias `host`). Files under /srv are mounted rw at their real paths; /etc,
# /run and systemd are host-only → go through ssh host.

host() { ssh host "$@"; }

require_host() {
  if ! command -v ssh >/dev/null 2>&1 || ! ssh -o BatchMode=yes -o ConnectTimeout=5 host true 2>/dev/null; then
    die "host root shell ('ssh host') unavailable — cannot reach /etc or systemd"
  fi
}

# Backup one path on the host if it exists, with a reason tag.
backup_host() { # backup_host PATH REASON
  local p="$1" why="${2:-backup}" utc
  if host "[ -f '$p' ]"; then
    utc="$(date -u +%Y%m%dT%H%M%SZ)"
    log "backup: $p -> $p.bak-$why-$utc"
    if [ "$DRY" -eq 0 ]; then
      host "cp -a '$p' '$p.bak-$why-$utc'"
    fi
  fi
}

# Idempotently write a file (repo template -> destination). Skips write when
# content identical; backs up before overwrite. Works on the mounted /srv
# paths directly (rw) or via ssh host when DEST is outside /srv.
install_file() { # install_file SRC DEST MODE [REASON]
  local src="$1" dst="$2" mode="${3:-0644}" why="${4:-install}"
  if [ ! -f "$src" ]; then
    die "template missing: $src"
  fi
  if [ "${dst#/srv/}" = "$dst" ] && [ "${dst#/opt/data}" = "$dst" ] && [ "${dst#/var}" = "$dst" ]; then
    # host-only path (/etc, /run, systemd): compare + write over ssh
    host "test -d '$(dirname "$dst")' || mkdir -p '$(dirname "$dst")'"
    if host "cmp -s '$src' '$dst' 2>/dev/null"; then
      log "already installed: $dst"
      return 0
    fi
    backup_host "$dst" "$why"
    log "install: $dst"
    if [ "$DRY" -eq 0 ]; then
      host "install -m $mode '$src' '$dst'"
    fi
    return 0
  fi
  # mounted path: local
  local dir; dir="$(dirname "$dst")"
  mkdir -p "$dir"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    log "already installed: $dst"
    return 0
  fi
  local utc; utc="$(date -u +%Y%m%dT%H%M%SZ)"
  if [ -f "$dst" ]; then
    log "backup: $dst -> $dst.bak-$why-$utc"
    if [ "$DRY" -eq 0 ]; then cp -a "$dst" "$dst.bak-$why-$utc"; fi
  fi
  log "install: $dst (mode $mode)"
  if [ "$DRY" -eq 0 ]; then
    install -m "$mode" "$src" "$dst"
  fi
}

# Install host-only content by piping it over ssh (backup-first, atomic).
# use when the source is a rendered string, not a host-existing file:
#   install_host_content /etc/systemd/system/x.service "$content" 0644 boomerang
install_host_content() { # install_host_content DEST CONTENT MODE [REASON]
  local dst="$1" content="$2" mode="${3:-0644}" why="${4:-install}"
  require_host
  backup_host "$dst" "$why"
  log "install (host content): $dst (mode $mode)"
  if [ "$DRY" -eq 0 ]; then
    printf '%s\n' "$content" | ssh host "cat > '$dst' && chmod $mode '$dst'"
  fi
}

# Render %PLACEHOLDER% substitution from a template file to stdout.
render_template() { # render_template FILE
  local f="$1" out
  out="$(sed -e "s|%BOOMERANG_ROOT%|$BOOMERANG_ROOT|g" \
             -e "s|%SCRIPTS_DIR%|$SCRIPTS_DIR|g" \
             -e "s|%STATE_DIR%|$STATE_DIR|g" \
             -e "s|%HUB_DIR%|$HUB_DIR|g" \
             -e "s|%JARVIS_ENV%|$JARVIS_ENV|g" \
             -e "s|%PI_SPOOL%|$PI_SPOOL|g" "$f")"
  printf '%s\n' "$out"
}

# Install an idempotent host cron (backup-first).
install_cron() { # install_cron NAME CRON_LINE_CONTENT
  local name="$1" content="$2"
  local crond="/etc/cron.d/$name"
  require_host
  backup_host "$crond" "$name"
  log "install cron: $crond"
  if [ "$DRY" -eq 0 ]; then
    host "cat > '$crond' <<'EOCRON'
$content
EOCRON
chmod 0644 '$crond'"
  fi
}
