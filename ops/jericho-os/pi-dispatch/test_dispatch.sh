#!/usr/bin/env bash
# pi-dispatch guardrail smoke tests (secret quarantine + stale delivery)
# Sets up a throwaway spool, drives the dispatcher functions directly.
set -uo pipefail
spool=/tmp/pi-dispatch-test-$$
mkdir -p "$spool/_system" "$spool/pa/home/pi-dispatch/requests"
cat > "$spool/lanes.json" <<JSON
{"spool_root":"$spool","max_concurrent_tabs":5,"stale_hours":6,
 "provider":"pi/hyperfusion/deepseek-ai/DeepSeek-V4-Flash-0731","thinking":"high",
 "lanes":{"pa":{"display":"PA","home":"$spool/pa/home","remote":false}}}
JSON
LANES="$spool/lanes.json" SPOOL="$spool" python3 - <<'PY'
import json, os, pathlib, sys, time
import dispatch

spool = pathlib.Path(os.environ["SPOOL"])
dispatch.LANES_FILE = pathlib.Path(os.environ["LANES"])
lanes = {"pa": {"display": "PA", "home": str(spool / "pa/home"), "remote": False}}
reqdir = pathlib.Path(lanes["pa"]["home"]) / "pi-dispatch" / "requests"

# --- 1) secret request -> quarantine, never fired ---------------------------
secrets = {"id": "sec001", "requester": "pa", "title": "x",
           "prompt": "please rotate the api_key=ghp_LIVETOKENTHATISFAKE1234567890 for me",
           "created_at": "2026-09-11T00:00:00Z"}
(reqdir / "sec001.json").write_text(json.dumps(secrets))
st = dispatch.State(spool)
dispatch.ingest_requests(spool, lanes, st, dry=False)
qdir = spool / "_quarantine"
assert (qdir / "sec001.json").exists(), "secret request was not quarantined"
assert not (reqdir / "sec001.json").exists(), "secret request not removed from lane"
assert "sec001" not in st.data["requests"], "secret request entered state"
print("PASS: secret request quarantined, not fired")

# --- 2) stale request -> delivered exactly once as STALE --------------------
old = {"id": "stale001", "lane": "pa", "tab_id": "00000000000000000000000000000000",
       "fired_at": time.strftime("2026-09-05T%H:%M:%SZ", time.gmtime()),
       "cwd": str(spool / "pa/work/stale001"), "status": "dispatched",
       "delivered_at": None}
st.data["requests"]["stale001"] = old
st.save()
delivered = dispatch.poll_and_deliver(spool, lanes, st, dry=False, stale_hours=6)
assert delivered == 1, "stale request not delivered once"
rec = st.data["requests"]["stale001"]
assert rec["status"] == "stale", "expected stale status, got %s" % rec["status"]
ans = pathlib.Path(lanes["pa"]["home"]) / "pi-dispatch" / "answers" / "stale001.md"
assert ans.exists() and "STALE" in ans.read_text().upper(), "STALE marker missing in answer"
# exactly once: a second poll must not redeliver
delivered2 = dispatch.poll_and_deliver(spool, lanes, st, dry=False, stale_hours=6)
assert delivered2 == 0, "stale request redelivered (not exactly-once)"
print("PASS: stale request marked STALE and delivered exactly once")

# --- 3) clean queued request -> dry-run does not fire, real fire attempted ---- 
clean = {"id": "clean001", "requester": "pa", "title": "c", "prompt": "sum 2+2 please",
         "created_at": time.strftime("2026-09-11T%H:%M:%SZ", time.gmtime())}
(reqdir / "clean001.json").write_text(json.dumps(clean))
st2 = dispatch.State(spool)   # fresh in-memory state; simulated
PY
rm -rf "$spool"
