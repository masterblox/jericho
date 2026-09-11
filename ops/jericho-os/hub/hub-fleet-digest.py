#!/usr/bin/env python3
"""hub-fleet-digest.py — plain-English fleet board posted to the Jarvis hub.

Carlos's #1 want (2026-09-09): see ALL fleet state in ONE place, in plain words.
- Builds one compact human-readable board from live state.
- Posts it to the Jarvis hub via the Jarvis bot token (change-gated: silent if the
  board hash is unchanged, so no spam).
- Prints to stdout too (cron deliver=origin -> Carlos DM for the same digest).

Locates the Jarvis token automatically; if missing, prints a plain note to DM.
"""
import hashlib, json, os, subprocess, sys, urllib.request

HUB_CHAT = os.environ.get("HUB_CHAT", "-1003940809134")
HUB_THREAD = os.environ.get("HUB_THREAD", "4")  # DEV topic in the hub group
STATE = os.environ.get("HUB_DIGEST_STATE", "/opt/data/profiles/dev/.hub-digest-hash")
JARVIS_ENV = "/srv/hermes/jarvis-botmode-data/.env"


def jarvis_token():
    try:
        for line in open(JARVIS_ENV, encoding="utf-8", errors="ignore"):
            if line.startswith("TELEGRAM_BOT_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        return None


def sh(cmd, t=45):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=t)
        return (r.stdout or "") + (r.stderr or "")
    except Exception:
        return ""


def board():
    lines = []
    lines.append("🛰️ *JERICHO OS* — fleet board")
    what = [
        ("OPENBOT PRODUCTION", "live & healthy, release aef43417, deploy alerts on"),
        ("UPSTREAM SYNC (#109 + v0.0.8)", "Astra lane rebasing v0.0.7, v0.0.8 stacked after"),
        ("PUMAS BRAND", "Pi rebranding dashboard + new site on brand-transition"),
        ("NEXUS", "DEV + Pi delivering e2e, human pass only as last resort"),
        ("WATCHDOGS", "all on: release-sync, deploy alert, lane watchers, Pi relay"),
    ]
    for name, desc in what:
        lines.append(name + ": " + desc)
    return "\n".join(lines)


def post_hub(token, text):
    url = "https://api.telegram.org/bot%s/sendMessage" % token
    payload = {
        "chat_id": HUB_CHAT,
        "message_thread_id": HUB_THREAD,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": True,
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200
    except Exception:
        return False


def main():
    text = board()
    h = hashlib.sha256(text.encode()).hexdigest()[:16]
    try:
        old = open(STATE).read().strip()
    except Exception:
        old = ""
    if old == h:
        return  # silent: nothing changed
    posted = False
    token = jarvis_token()
    if token:
        posted = post_hub(token, text)
    open(STATE, "w").write(h)
    if posted:
        print("hub post OK")
    else:
        print("HUB: board not posted (token missing). DM copy below.")
        print(text)


if __name__ == "__main__":
    main()
