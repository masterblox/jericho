#!/usr/bin/env bash
# Jericho OS — install everything (boomerang + continuation + hub + pi-dispatch)
#
# Runs the four module installers in dependency order. Any module can be
# skipped by name. --dry-run propagates to every module (prints, changes
# nothing).
#
#   bash install/install-all.sh                 # full install
#   bash install/install-all.sh --dry-run       # plan only
#   bash install/install-all.sh --skip hub      # skip a module
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DRY=0
SKIP=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --skip) SKIP+=("NEXT") ;;
    --skip=*) SKIP+=("${a#--skip=}") ;;
    *) [ "${#SKIP[@]}" -gt 0 ] && SKIP+=("$a") ;;
  esac
done

skip() { for s in "${SKIP[@]}"; do [ "$s" = "$1" ] && return 0; done; return 1; }

ARGS=(); [ "$DRY" -eq 1 ] && ARGS+=(--dry-run)

run() {
  local name="$1" script="$2"; shift 2
  if skip "$name"; then echo "== skipping $name =="; return 0; fi
  echo "== $name =="
  bash "$here/$script" "${ARGS[@]}"
}

run boomerang    install-boomerang.sh
run continuation install-continuation.sh
run hub          install-hub.sh
run pi-dispatch  install-pi-dispatch.sh

echo "== install-all done (dry-run=$DRY) =="
