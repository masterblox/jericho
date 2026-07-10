#!/usr/bin/env python3
"""Quick Paperclip API health check with 3s timeout."""
import urllib.request
import json

API_KEY = "jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
BASE = "http://hermes-vps.tailc4f632.ts.net:3100"
RUN_ID = "98508c7c-101d-4a18-b1af-aade251aaaad"

endpoints = [
    ("health", f"{BASE}/api/health"),
    ("agents/me", f"{BASE}/api/agents/me"),
    ("agents", f"{BASE}/api/companies/5e826a0c-c9ea-4f28-8646-7d340629dc92/agents"),
]

for name, url in endpoints:
    try:
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {API_KEY}",
            "X-Paperclip-Run-Id": RUN_ID
        })
        resp = urllib.request.urlopen(req, timeout=3)
        print(f"[{name}] HTTP {resp.status}: {resp.read()[:200]}")
    except urllib.error.HTTPError as e:
        print(f"[{name}] HTTP {e.code}: {e.read()[:200]}")
    except Exception as e:
        print(f"[{name}] ERROR: {type(e).__name__}: {e}")

# Also try a raw socket check
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(3)
try:
    s.connect(("127.0.0.1", 3100))
    print("[socket] Port 3100 local: CONNECTED")
    s.close()
except Exception as e:
    print(f"[socket] Port 3100 local: {e}")
