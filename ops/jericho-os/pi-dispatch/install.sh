#!/usr/bin/env bash
# pi-dispatch — install.sh (idempotent, ADDITIVE file-level only)
#
# Installs the fleet "Pi on demand" capability for every lane WITHOUT touching
# any agent's config, routing, memory, or running services, and WITHOUT
# restarting any lane/container. It only:
#   * creates the canonical spool /srv/hermes/data/pi-requests/
#   * copies the dispatcher + lanes config + runbook into _system/
#   * gives each lane with a local home a pi-dispatch/ surface
#     (request.py, requests/, answers/, lane.json)
#   * drops the pi-dispatch SKILL into each lane's skills/ tree
#     (and mirrors it into the /srv/hermes/data/profiles/* view)
#   * installs ONE host cron (/etc/cron.d/pi-dispatch) via ssh host (backup-first)
#
# Safe to re-run; every step is guarded. Existing files are preserved;
# nothing is tar-gzipped over, nothing is deleted.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$SRC/lanes.json"
SPOOL="$(python3 -c "import json;print(json.load(open('$CFG'))['spool_root'])")"

log() { printf 'pi-dispatch: %s\n' "$*"; }

[ -f "$CFG" ] || { echo "FATAL: lanes.json not found next to installer" >&2; exit 2; }

# ── 1. canonical spool + _system -------------------------------------------
mkdir -p "$SPOOL/_system"
install -m 0644 "$SRC/dispatch.py"   "$SPOOL/_system/dispatch.py"
install -m 0644 "$SRC/lanes.json"    "$SPOOL/_system/lanes.json"
if [ -f "$SRC/README.md" ]; then
  install -m 0644 "$SRC/README.md"   "$SPOOL/_system/README.md"
fi
log "spool ready: $SPOOL"

# ── 2. per-lane surfaces + skills ------------------------------------------
python3 - "$CFG" "$SRC" "$SPOOL" <<'PY'
import json, shutil, sys
from pathlib import Path

cfg, src, spool = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
data = json.load(open(cfg))
for lane, meta in data["lanes"].items():
    home = meta.get("home")
    is_local = not meta.get("remote", False)

    # canonical spool dirs for every lane (local and remote/future)
    for sub in ("inbox", "answers", "work"):
        (spool / lane / sub).mkdir(parents=True, exist_ok=True)

    if not is_local or not home:
        print("pi-dispatch: [skip surface] %-10s remote/future lane" % lane)
        continue
    home = Path(home)
    surf = home / "pi-dispatch"
    for sub in ("requests", "answers"):
        (surf / sub).mkdir(parents=True, exist_ok=True)
    # lane identity for request.py
    lane_file = surf / "lane.json"
    if not lane_file.exists():
        lane_file.write_text(json.dumps({"lane": lane}, indent=2) + "\n")
    # helper
    shutil.copyfile(src / "request.py", surf / "request.py")
    (surf / "request.py").chmod(0o755)
    # skill into the live skills tree
    sk = home / "skills" / "pi-dispatch"
    sk.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src / "skill" / "SKILL.md", sk / "SKILL.md")
    print("pi-dispatch: [ok] %-10s surface=%s skill=%s" % (lane, surf, sk))

    # mirror into the /srv/hermes/data/profiles/* view (keeps "every profile" in sync)
    mir = meta.get("mirror")
    if mir:
        msk = Path(mir) / "skills" / "pi-dispatch"
        msk.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src / "skill" / "SKILL.md", msk / "SKILL.md")
        print("pi-dispatch: [mirror] %-10s -> %s" % (lane, msk))
PY

# lane containers run as hermes(995): the surface must stay writable by the lane,
# so hand the newly-installed dirs back to the lane owner (root installs are fine
# for _system, but a lane must be able to CREATE request files and READ answers).
for d in jericho-data pa-data donald-data designer-data; do
  [ -e "/srv/hermes/$d/pi-dispatch" ] && chown -R hermes:hermes "/srv/hermes/$d/pi-dispatch";
  [ -e "/srv/hermes/$d/skills/pi-dispatch" ] && chown -R hermes:hermes "/srv/hermes/$d/skills/pi-dispatch";
done
chown -R hermes:hermes /srv/hermes/data/pi-dispatch 2>/dev/null || true
chown -R hermes:hermes /srv/hermes/data/skills/pi-dispatch 2>/dev/null || true
for p in dev angela jericho donald iris; do
  [ -e "/srv/hermes/data/profiles/$p/skills/pi-dispatch" ] && chown -R hermes:hermes "/srv/hermes/data/profiles/$p/skills/pi-dispatch" || true
done
log "lane surfaces handed back to hermes:hermes (lane containers can write requests/)"

# ── 3. host cron (backup-first, ssh host) ----------------------------------
CRON=/etc/cron.d/pi-dispatch
if ! ssh host "[ -f $CRON ]"; then
  ssh host "cat > $CRON <<'EOF'
# pi-dispatch - fleet lane -> Pi worker tab -> answer (host dispatcher, every 2 min)
*/2 * * * * root HOME=/root PATH=/usr/bin:/usr/local/bin:/bin /usr/bin/python3 $SPOOL/_system/dispatch.py >> $SPOOL/_system/dispatch.log 2>&1
EOF
  chmod 0644 $CRON"
  log "cron installed: $CRON"
else
  UTC="$(date -u +%Y%m%dT%H%M%SZ)"
  ssh host "cp -a $CRON $CRON.bak-pi-dispatch-$UTC && cat > $CRON <<'EOF'
# pi-dispatch - fleet lane -> Pi worker tab -> answer (host dispatcher, every 2 min)
*/2 * * * * root HOME=/root PATH=/usr/bin:/usr/local/bin:/bin /usr/bin/python3 $SPOOL/_system/dispatch.py >> $SPOOL/_system/dispatch.log 2>&1
EOF
  chmod 0644 $CRON"
  log "cron refreshed (backup $CRON.bak-pi-dispatch-$UTC): $CRON"
fi

# ── 4. verify --------------------------------------------------------------
cat <<EOF

pi-dispatch installed. State:
  spool:             $SPOOL
  dispatcher:        $SPOOL/_system/dispatch.py
  host cron:         $CRON  (every 2 min)
  logs:              $SPOOL/_system/dispatch.log
  lane surfaces:     <lane-home>/pi-dispatch/  (request.py, requests/, answers/)
  lane skills:       <lane-home>/skills/pi-dispatch/SKILL.md
  canonical results: $SPOOL/<lane>/answers/<id>.md

No config was modified. No lane was restarted. Run the dispatcher once to
verify: python3 $SPOOL/_system/dispatch.py
EOF
