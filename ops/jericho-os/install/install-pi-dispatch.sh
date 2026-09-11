#!/usr/bin/env bash
# Jericho OS — install pi-dispatch ("Pi for every agent")
#
# Thin wrapper over the canonical pi-dispatch/install.sh (single source of
# truth — reference, don't duplicate). It installs the spool, dispatcher,
# per-lane surfaces + skills and the host cron.
#
# --dry-run: reports the steps pi-dispatch/install.sh would run (spool,
# lanes, cron) WITHOUT executing anything (the canonical installer itself
# currently has no dry-run; this wrapper gates execution).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DRY=0
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY=1; done

pi_install="$here/../pi-dispatch/install.sh"
[ -f "$pi_install" ] || { echo "FATAL: $pi_install missing" >&2; exit 2; }
cfg="$here/../pi-dispatch/lanes.json"
spool="$(python3 -c "import json,sys;print(json.load(open('$cfg'))['spool_root'])")"
lane_count="$(python3 -c "import json,sys;print(len(json.load(open('$cfg'))['lanes']))")"

log() { printf 'jericho-os-install: %s\n' "$*"; }

log "pi-dispatch install (canonical installer: $pi_install)"
log "spool=$spool lanes=$lane_count dry-run=$DRY"

if [ "$DRY" -eq 1 ]; then
  log "[dry-run] would create canonical spool:  $spool"
  log "[dry-run] would install dispatcher:      $spool/_system/dispatch.py"
  log "[dry-run] would install host cron:       /etc/cron.d/pi-dispatch (every 2 min)"
  log "[dry-run] would create per-lane surfaces (request.py, requests/, answers/) + skills/pi-dispatch"
  log "[dry-run] nothing executed. Run without --dry-run to apply."
  exit 0
fi

bash "$pi_install"
log "pi-dispatch install complete (delegated to canonical installer)."
