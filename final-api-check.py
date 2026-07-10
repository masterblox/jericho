#!/usr/bin/env python3
"""Final Paperclip API check for MAS-354 closure."""
import urllib.request, urllib.error, socket, sys

API_KEY = "jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
BASE = "http://hermes-vps.tailc4f632.ts.net:3100"

results = {}

# Test 1: Quick health check
try:
    req = urllib.request.Request(f"{BASE}/api/health")
    resp = urllib.request.urlopen(req, timeout=5)
    results['health'] = f"HTTP {resp.status}"
except Exception as e:
    results['health'] = f"FAIL: {type(e).__name__}"

# Test 2: Agents endpoint with auth
try:
    req = urllib.request.Request(
        f"{BASE}/api/companies/5e826a0c-c9ea-4f28-8646-7d340629dc92/agents",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    resp = urllib.request.urlopen(req, timeout=5)
    results['agents'] = f"HTTP {resp.status}"
except urllib.error.HTTPError as e:
    results['agents'] = f"HTTP {e.code}"
except Exception as e:
    results['agents'] = f"FAIL: {type(e).__name__}"

# Test 3: Try PATCH on MAS-54
MAS54_UUID = "c6e443b6-b3ec-4ead-aefd-eec9988a06a7"
try:
    data = '{"status":"done"}'.encode()
    req = urllib.request.Request(
        f"{BASE}/api/issues/{MAS54_UUID}",
        data=data,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "X-Paperclip-Run-Id": "98508c7c-101d-4a18-b1af-aade251aaaad"
        },
        method="PATCH"
    )
    resp = urllib.request.urlopen(req, timeout=5)
    results['patch_mas54'] = f"HTTP {resp.status}: {resp.read()[:100]}"
except urllib.error.HTTPError as e:
    results['patch_mas54'] = f"HTTP {e.code}: {e.read()[:100]}"
except Exception as e:
    results['patch_mas54'] = f"FAIL: {type(e).__name__}: {e}"

for k, v in results.items():
    print(f"[{k}] {v}")

# Determine actionability
if '200' in results.get('health', '') or '401' in results.get('health', ''):
    print("\nAPI IS REACHABLE")
    if '200' in results.get('patch_mas54', ''):
        print("MAS-54 PATCH SUCCEEDED — issue closed!")
    elif '403' in results.get('patch_mas54', ''):
        print("MAS-54 still auth-blocked")
else:
    print("\nAPI UNREACHABLE — confirmed blocked")
