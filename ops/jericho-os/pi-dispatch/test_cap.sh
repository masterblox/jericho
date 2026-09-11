#!/usr/bin/env bash
set -uo pipefail
spool=/tmp/pi-dispatch-cap-$$
mkdir -p "$spool/_system"
cat > "$spool/lanes.json" <<JSON
{"spool_root":"$spool","max_concurrent_tabs":5,"stale_hours":6,
 "provider":"pi/hyperfusion/deepseek-ai/DeepSeek-V4-Flash-0731","thinking":"high",
 "lanes":{"pa":{"display":"PA","home":"$spool/pa/home","remote":false}}}
JSON
LANES="$spool/lanes.json" SPOOL="$spool" python3 - <<'PY'
import json, os, pathlib
import dispatch
spool = pathlib.Path(os.environ["SPOOL"])
dispatch.LANES_FILE = pathlib.Path(os.environ["LANES"])
lanes = {"pa": {"display": "PA", "home": str(spool / "pa/home"), "remote": False}}
st = dispatch.State(spool)
fired = {"n": 0}
def fake_fire(lane, req, cwd, provider, thinking, extra_env=None):
    fired["n"] += 1
    return {"ok": True, "tab_id": "tab-%04d" % fired["n"]}
dispatch.paseo_fire = fake_fire
for i in range(1, 8):  # 7 queued requests, cap = 5
    st.data["requests"]["req%03d" % i] = {
        "id": "req%03d" % i, "lane": "pa", "title": "t%d" % i,
        "prompt": "task %d" % i, "created_at": "2026-09-11T00:00:%02dZ" % i,
        "status": "queued", "tab_id": None, "fired_at": None,
        "delivered_at": None, "cwd": None, "error": None}
n = dispatch.fire_pending(spool, lanes, st, dry=False)
print("fired this cycle:", n, "| total fake tabs:", fired["n"])
assert fired["n"] == 5, "expected exactly 5 fired under cap, got %d" % fired["n"]
assert sum(1 for r in st.data["requests"].values() if r["status"] == "dispatched") == 5
assert sum(1 for r in st.data["requests"].values() if r["status"] == "queued") == 2
print("PASS: concurrency cap = 5 respected (2 held queued)")
PY
rm -rf "$spool"
