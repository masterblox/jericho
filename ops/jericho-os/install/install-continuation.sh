#!/usr/bin/env bash
# Jericho OS — install continuation engine (tier-1 trigger)
#
# Installs the paseo monitor/context/mark scripts (+ the shared hub digest),
# and provides the cron JOB TEMPLATE. Merging the job into a lane's
# cron/jobs.json is a SEPARATE, guarded step — see install/README.md and
# REBUILD.md. This installer touches no cron configuration on its own.
#
# Safe to re-run. Backup-first. --dry-run prints without changing anything.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$here/common.sh"

parse_flags "$@"

repo="$here/../continuation"
log "continuation install (scripts=$SCRIPTS_DIR hub=$HUB_DIR state=$STATE_DIR)"

install_file "$repo/paseo-finished-digest.py"     "$SCRIPTS_DIR/paseo-finished-digest.py"      0755 "continuation"
install_file "$repo/paseo-pending-completions.py" "$SCRIPTS_DIR/paseo-pending-completions.py"  0755 "continuation"
install_file "$repo/paseo-mark-processed.py"      "$SCRIPTS_DIR/paseo-mark-processed.py"       0755 "continuation"

# the job definition ships with the bundle; the operator merges it deliberately
install_file "$repo/continuation-job.json" "$SCRIPTS_DIR/continuation-job.json" 0644 "continuation"

mkdir_if_missing() { [ -d "$1" ] || { log "mkdir: $1"; [ "$DRY" -eq 0 ] && mkdir -p "$1"; }; }
mkdir_if_missing "$STATE_DIR"

log "continuation scripts + job template installed."
log "To wire the cron job, see install/README.md §continuation (add-continuation-job.py, backup-first)."
log "Job prompt placeholders resolve to SCRIPTS_DIR=$SCRIPTS_DIR"
