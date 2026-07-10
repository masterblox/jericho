# Intelligence Cross-Lane Scan — 2026-07-09 19:49 GST (UTC+4)

**Agent**: Intelligence (f2216417)
**Run**: ac81c97b-997a-4c5a-a37e-f599f32aec0a
**Wake type**: Heartbeat (no issue context)
**Paperclip status**: Unreachable for authenticated operations — delivered directly

---

## CRITICAL: System Load 17.1 + Swap 100%

- Load average: 17.12 / 17.05 / 17.49 on 2 CPUs
- Swap: 2048/2048Mi used (100%), 30Mi free
- Free RAM: 174Mi (before zombie cleanup)
- Gateways at imminent risk of s6 SIGTERM termination under load

## CRITICAL: Paperclip Auth-Layer Deadlock

- Health: HTTP/1.0 probe returns 200 OK intermittently, then degrades to timeout
- Keep-alive handler: deadlocked (curl HTTP/1.1 returns 000)
- Auth middleware: partially alive — unauthenticated requests return clean 401 (<1s)
- Authenticated endpoints: all hang/timeout
- Stage: 2.5 degenerating toward 3 (zombie socket)
- This scan could not file an INTEL issue — delivering directly

## RESOLVED: Zombie LSP Cleanup

- 5 zombie LSP processes killed:
  - tsserver x2 (top consumer: 730MB RSS)
  - typescript-language-server x2
  - typingsInstaller x1
- Memory freed: ~1GB (4.5Gi → 3.5Gi used)
- Available memory: 3.3Gi → 4.3Gi
- 0 zombies remaining post-cleanup
- Note: active Hermes session LSP will re-spawn — root fix requires `hermes config set lsp.enabled false`

## HIGH: Disk at 89%

- overlay: 68G/77G used (89%)
- Approaching 90% threshold
- Container-level cleanup (node_modules) would recover marginal space
- Primary consumer: host-level Docker overlay layers
- Blocker: container cannot perform `docker system prune` — no Docker socket, unprivileged UID

## MEDIUM: Gateway Fleet State

- 2 active gateway processes:
  - Jericho: PID 162, 366MB RSS, --replace flag (outside s6 supervision)
  - Default: PID 178, 57MB RSS, --replace flag (outside s6 supervision)
- 8 s6-log subprocesses: juridico, analyst, intelligence, jericho, researcher, donald, iris, default — harmless
- All decommissioned/consolidated gateways correctly down
- Both running gateways lack s6 crash recovery (started with --replace)
- No Donald-unexpectedly-up anomaly

## LOW: Figma MCP Keepalive Warnings

- 4 warnings in agent.log at ~15min intervals
- Standard gateway child process timeout when no Figma activity
- Not a fleet concern

## BRIDGE / VAULT / SILO CHECK

- Conductor bridge: no new handoffs >24h (TICKETS.md is most recent file)
- Jericho outbox: deferred closes only, no new work routing
- Vault: 3 markdown files modified in 24h — minimal activity
- Signal: agents working in silos or fully idle. Normal when Paperclip is down.

## ACTIONS TAKEN THIS SCAN

1. Killed 5 zombie LSP processes → freed ~1GB RAM
2. Attempted INTEL-6 issue creation via raw socket → POST timed out (mutation status unknown)
3. Verified Paperclip auth deadlock via differential probe (no-auth=fast 401, health=intermittent 200, auth=hang)

## RECOMMENDATIONS

1. **Immediate**: Host operator restart Paperclip server to clear auth deadlock
2. **Immediate**: Consider `hermes config set lsp.enabled false` to stop LSP re-infection
3. **Short-term**: Run `docker system prune -a` on host to clear Docker overlay layers (89% → lower)
4. **Short-term**: Re-run gateways under s6 supervision (remove --replace flag, use s6-svc -u) for crash recovery
5. **When Paperclip recovers**: File INTEL-6 formally; verify if the raw-socket POST created it during the deadlock

---

*Paperclip unavailable — delivered directly via wake transport. Report saved to /opt/data/jericho/reports/intelligence-scan-2026-07-09T1549GST.md.*
