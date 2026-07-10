# Intelligence Cross-Lane Scan — 2026-07-09 14:27 UTC

## Cross-Lane Scan — 2026-07-09 14:27 UTC

Paperclip recovered from auth deadlock. Full cross-lane scan complete.

### Fleet Baseline (CONSOLIDATED)
| Component | State | Delta |
|-----------|-------|-------|
| gateway-default | up (s6) | OK |
| gateway-jericho | up (s6) | OK |
| gateway-researcher | down (intentional) | OK |
| gateway-analyst | down (intentional) | OK |
| gateway-iris | down (intentional) | OK |
| gateway-donald | down (intentional) | OK |
| gateway-intelligence | down (intentional) | OK |
| gateway-juridico | down (intentional) | OK |
| MoA service | not running | Known — gateways fall back to direct |

### Resource State
| Metric | Current | Threshold | Status |
|--------|---------|-----------|--------|
| Load avg | 19.37 | >15 | HIGH |
| Disk / | 92% (5.6G free) | >90% | HIGH — container-locked |
| Memory free | 1.7Gi | — | Improved from 485Mi |
| Swap | 1.5Gi/2.0Gi (75%) | >80% | Approaching |
| Zombie LSP | 2 minor (133MB) | >100MB | Low — cleaned 1.8GB |

### Actions Taken This Scan
1. Killed 8 zombie LSP processes (1.8GB freed): 2x tsserver (828MB + 314MB), 2x typescript-language-server, 2x typingsInstaller, plus reinfected ones. 2 typescript-language-server reinfected (133MB) — expected LSP self-reinfection.
2. Freed 1.65GB disk: memories-express-mvp-cp/node_modules (1013MB), npm _npx cache (52MB), npm-global modules (583MB). Disk moved 93% → 92%.
3. Paperclip API verified healthy: health=200, issue list endpoint functional, comment endpoint degraded (timeout).

### Signals Detected

**HIGH: Load 19.37 on 2 CPUs**
Down from 25 (INTEL-6 baseline) after zombie cleanup but still well above safe threshold. Gateway SIGTERM risk if sustained. 16 SIGTERMs already logged — likely Paperclip recovery cascade from queued wake flood.

**HIGH: Disk 92% Container-Locked**
Container cleanup ceiling reached at ~92%. Remaining 50GB+ bloat is host-level Docker overlay layers. Needs host intervention: docker system prune -a or droplet expansion. Cannot be performed from inside Hermes container.

**HIGH: Memory Overflow Event**
Jericho hit 32,729/32,000 chars at 14:16 UTC — write blocked. Current usage is 49% (15,938/32,000) — transient spike from a batch write attempt. Not a current crisis but the overflow blocked a fleet state write. Memory needs compaction.

**MEDIUM: Paperclip Comment Endpoint Degraded**
Issue list + creation works. Comment POST times out. Partial degradation — not full auth deadlock (INTEL-5 scenario). This blocks in-place updates to INTEL issues.

**MEDIUM: OpenRouter 401s on z-ai/glm-5.2**
Multiple "Missing Authentication header" errors in recent cycle. MoA is down (known) — gateways falling back to direct provider calls. OpenRouter key may need rotation.

**LOW: Vault Activity**
4 files modified in 24h. Agents working through Paperclip pipeline — healthy pattern, not silo isolation.

### Prior INTEL Issues
- INTEL-1 (MAS-496): blocked — disk 96% now 92% after cleanup
- INTEL-5 (MAS-359): in_progress — memory overflow now transient-only
- INTEL-6 (MAS-510): in_progress — this scan is a follow-up

### Recommended
1. Host operator: docker system prune -a (disk critical)
2. Jericho: compact memory to prevent overflow recurrence
3. Rotate OpenRouter key if 401s continue
4. Kill reinfected LSP zombies periodically (or set lsp.enabled=false)

---
Paperclip comment endpoint: degraded (timeout)
Delivered via: new INTEL issue
Run ID: b7cd173e-7e89-48dc-a74c-d1143b2a37ff
