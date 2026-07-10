# Module 6: Pitfalls & Recovery v2

**Goal**: Recognize error patterns that emerged Jul 7-9, 2026. Auto-updated from fleet logs.

**Parent**: Continues Module 4 (patterns #1-#16). Patterns here are #17+.

---

## New Patterns (Jul 7-9, 2026)

### 17. Anthropic auth_mode Config Spam

```
hermes_cli.config: providers.anthropic: unknown config keys ignored: auth_mode
```

**Frequency**: 139 occurrences (Jul 7-8). Fires on every session start and every tool registry check. Zero occurrences before Jul 7.

**Affected agents**: All (gateway-level, not per-agent).

**Root cause**: `config.yaml` contains an `auth_mode` key under `providers.anthropic` that the config parser doesn't recognize. Likely introduced by a config update or `enforce-fleet-routing.py` run on Jul 7.

**Impact**: Pure noise — no functional impact, but floods logs and makes real errors harder to spot. Every tool availability check spits this line.

**Fix**: Remove `auth_mode` from the `providers.anthropic` block in `/opt/data/config.yaml`:
```yaml
providers:
  anthropic:
    # auth_mode: ...  ← DELETE THIS LINE
    api_key: sk-...
```

**Prevention**: Add `auth_mode` to known/silenced config keys for the anthropic provider parser, or validate config after fleet-routing script runs.

---

### 18. MCP 'jericho-mini' Missing Executable

```
MCP server 'jericho-mini' initial connection failed (attempt 1/3):
  [Errno 2] No such file or directory: '/opt/jericho-mini/jericho-mini'
```

**Frequency**: 14 occurrences across 2 gateway restart cycles (Jul 7, 11:33 and 12:30 UTC+4). Fires 3 retries × 2 gateways per restart cycle. Zero before Jul 7.

**Affected agents**: Gateway (all profiles).

**Root cause**: Gateway config references an MCP server `jericho-mini` at `/opt/jericho-mini/jericho-mini`, but the binary doesn't exist on the container. Either the binary was never installed, or the config was added speculatively.

**Impact**: Every gateway restart wastes ~12s on 3 retry attempts (1s/2s/4s backoff). After giving up, gateway runs without the MCP server. No user-facing breakage unless agents depend on jericho-mini tools.

**Fix**: Option A — install `jericho-mini` binary at the expected path. Option B — remove the MCP server entry from gateway config (`hermes config` or direct config.yaml edit).

**Prevention**: Add pre-flight check in gateway startup: if MCP binary is missing, warn once and skip, don't retry 3 times every restart.

---

### 19. MoA 401 Authentication Cascade

```
agent.auxiliary_client: resolve_provider_client: unknown provider 'moa'
agent.moa_loop: MoA reference model openrouter:deepseek/deepseek-v4-pro failed:
  Error code: 401 - Missing Authentication header
agent.conversation_loop: API call failed (attempt 1/3) error_type=AuthenticationError
  provider=moa base_url=moa://local model=default summary=HTTP 401
agent.conversation_loop: Non-retryable client error: Error code: 401
```

**Frequency**: 9 occurrences in 2 cascades (Jul 8, 01:55 and 05:41 UTC+4). Each cascade fires 4-5 warnings + 1 ERROR.

**Affected agents**: DEV (sessions `20260707_110103_3892624a` and `20260708_054106_e972281b`). Gateway-wide impact.

**Root cause**: MoA ("Mixture of Agents") is configured as a local provider (`moa://local`) which chains to reference models (openrouter:deepseek-v4-pro). openrouter returns 401 (missing/invalid auth header) → MoA fails → primary model unavailable → gateway dead. This is distinct from #15 (auxiliary cascade) and #16 (permission cascade) — it's specifically the MoA aggregation layer failing because its upstream reference models lack auth.

**Impact**: **HARD GATEWAY FAILURE**. Agents cannot get any completions. Sessions die with non-retryable errors. The gateway is effectively offline until auth is restored.

**Fix**: 
1. Verify openrouter API key is valid and set: `hermes auth` or check `OPENROUTER_API_KEY`
2. Temporarily bypass MoA by switching to a direct provider: `hermes model deepseek-v4-pro --provider deepseek`
3. Remove MoA from provider chain until openrouter auth is fixed:
```bash
hermes config set providers.moa.enabled false
```

**Prevention**: MoA should fail fast on 401 from reference models instead of cascading through all of them. Add pre-flight auth check for MoA reference providers.

---

### 20. Goliath CAMOFOX_API_KEY 403

```
mcp_goliath_see: POST /tabs/{id}/evaluate: status 403:
  This endpoint requires CAMOFOX_API_KEY except for loopback requests
  in non-production environments.
mcp_goliath_js: POST /tabs/{id}/evaluate: status 403: same
mcp_goliath_act: POST /tabs/{id}/evaluate: status 403: same
```

**Frequency**: 7 occurrences on Jul 8 (19:19-19:46 UTC+4). Affects `see`, `js`, and `act` — everything that calls `/evaluate`.

**Affected agents**: DEV (session `20260708_054106_e972281b`).

**Root cause**: Goliath's `/evaluate` endpoints require a `CAMOFOX_API_KEY` header for non-loopback (non-localhost) requests. The container's outbound IP is treated as non-production, triggering the API key gate. This is distinct from #12 (tab expiry — 410/404/503) — tab IDs are valid but operations are rejected at the auth layer.

**Impact**: Goliath browser agent is fully blind. Can navigate pages but can't `see` (read page content), `act` (click/type), or `js` (execute JS). Agent loops retrying, wasting tokens.

**Fix**: Set `CAMOFOX_API_KEY` environment variable in container or gateway config. The key should be provisioned from the Camoufox/Goliath service dashboard.

**Prevention**: Add pre-flight check: on first Goliath call, test `/evaluate` on a known tab. If 403, alert immediately instead of retrying.

---

### 21. Memory Store Capacity Exhaustion

```
Memory at 31,812/32,000 chars. Adding this entry (506 chars) would exceed the limit.
After applying all 3 operations, memory would be at 33,018/32,000 chars — over the limit.
After applying all 1 operations, memory would be at 32,277/32,000 chars — over the limit.
memory would be at 8,397/8,000 chars -- over the limit.
```

**Frequency**: 8 occurrences (Jul 7-8). Mix of 32K-limit store and 8K-limit store.

**Affected agents**: DEV (session `20260707_110103_3892624a`).

**Root cause**: Memory stores have hard character limits (32,000 for the main store, 8,000 for a secondary store — likely user vs memory target). Agent keeps trying to add entries that would overflow. The batch `operations` approach allows multi-operation atomicity, but total char budget must fit within the limit.

**Impact**: Agent loops trying different memory batch combinations, wasting 4-5 turns each time. Cannot save new insights until old entries are consolidated or removed.

**Fix**: 
1. Run `memory(target='memory', action='read')` to see current entries
2. Consolidate overlapping entries: use `replace` to merge multiple entries into one shorter one
3. Remove stale entries: `remove` old_item + `add` new_item in one batch
4. For the 8K store specifically: be much more aggressive with consolidation

**Prevention**: Memory tool should provide a `consolidate` action or suggest which entries to merge. Agents should check `current_entries` length before building batch operations.

---

### 22. Background Review Tool Whitelist Denials

```
Background review denied non-whitelisted tool: read_file.
  Only memory/skill tools are allowed.
Background review denied non-whitelisted tool: search_files.
  Only memory/skill tools are allowed.
```

**Frequency**: 10 occurrences (Jul 7-8).

**Affected agents**: DEV (background curator process).

**Root cause**: The background skill curator/review process has a restricted tool whitelist — only `memory` and `skill_manage` tools. When the agent's background review hook tries to read a file or search for context, it's blocked.

**Impact**: Wasted turns. Agent attempts `read_file` → denied → tries `search_files` → denied → abandons. The background curator can't gather context it needs to make decisions about skill patches.

**Fix**: Agents should check available tools before calling `read_file`/`search_files` in background review context. If blocked, use `skill_view()` to read skill files (whitelisted), or defer the operation to the foreground.

**Prevention**: Background review whitelist should include `read_file` and `search_files` (read-only, low risk) to let the curator inspect files before patching.

---

### 23. Copilot Token Unsupported (ghp_*)

```
hermes_cli.copilot_auth: Token from GH_TOKEN is not supported:
  Classic Personal Access Tokens (ghp_*) are not supported by the Copilot API.
hermes_cli.copilot_auth: Token from GITHUB_TOKEN is not supported:
  Classic Personal Access Tokens (ghp_*) are not supported by the Copilot API.
```

**Frequency**: 12 occurrences (Jul 7-8). Fires once each for `GH_TOKEN` and `GITHUB_TOKEN`.

**Affected agents**: Gateway startup (all profiles using GitHub Copilot integration).

**Root cause**: Environment variables `GH_TOKEN` and/or `GITHUB_TOKEN` contain classic Personal Access Tokens (prefix `ghp_`), which the Copilot API rejects. Copilot requires fine-grained tokens (prefix `github_pat_`) or OAuth tokens.

**Impact**: GitHub Copilot integration is unavailable — agent can't use `openai-codex` provider or Copilot as a reference model. This contributes to the MoA cascade (#19) since openai-codex is one of the reference models.

**Fix**: Generate a fine-grained PAT from GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens. Set `GH_TOKEN` or `GITHUB_TOKEN` to the new token.

**Prevention**: Add a clear error message: "Classic PATs (ghp_*) are not supported — generate a fine-grained token at https://github.com/settings/tokens"

---

### 24. DNS Resolution Failure Cascade

```
browser_navigate: Navigation failed: net::ERR_NAME_NOT_RESOLVED
terminal: curl: (6) Could not resolve host: www.oa.pt
terminal: exit_code=6, exit_code_meaning=Could not resolve host
terminal: exit_code=28, exit_code_meaning=Operation timed out
browser_navigate: Navigation failed: net::ERR_CERT_AUTHORITY_INVALID
```

**Frequency**: 8 occurrences (Jul 7, 17:56-18:05 UTC+4). 7 browser failures + 3 terminal curl failures in a 9-minute window.

**Affected agents**: DEV (session `20260707_175442_6282ce`).

**Root cause**: Container DNS resolution failed — all hostnames returned NXDOMAIN or timed out. The `ERR_CERT_AUTHORITY_INVALID` suggests a secondary failure where DNS resolved but returned a captive portal / MITM proxy certificate. This may have been a transient Docker networking issue or upstream DNS provider outage.

**Impact**: Agent completely stuck — browser can't navigate anywhere, terminal curl can't reach any host. 9 minutes of retries before recovery.

**Fix**: 
1. Check DNS: `nslookup google.com` or `dig google.com`
2. Check Docker DNS: `cat /etc/resolv.conf` (should show 127.0.0.11 for Docker's embedded DNS)
3. Restart Docker networking: `docker network inspect bridge` (from host)
4. As last resort: `kill -HUP 1` to restart container init

**Prevention**: Agent should detect 3+ consecutive DNS failures and alert instead of retrying. Add DNS health check to pre-flight.

---

### 25. Shared Skill File Permission Denied

```
agent.prompt_builder: Failed to parse skill file
  /opt/data/skills/research/llm-wiki/SKILL.md:
  [Errno 13] Permission denied
```

**Frequency**: 9 occurrences (Jul 7-8). Same file every time.

**Affected agents**: DEV (session `20260707_110103_3892624a` and `20260708_054106_e972281b`).

**Root cause**: `/opt/data/skills/research/llm-wiki/SKILL.md` has incorrect ownership — likely root-owned after `enforce-fleet-routing.py` ran (see #16). The gateway runs as `hermes` user and can't read root-owned skill files.

**Impact**: The `llm-wiki` skill cannot be loaded. Agents skip it silently and proceed without its context. Skill discovery is degraded.

**Fix**: 
```bash
chown -R hermes:hermes /opt/data/skills/
```
Or more targeted:
```bash
chown hermes:hermes /opt/data/skills/research/llm-wiki/SKILL.md
```

**Prevention**: Extend the #16 fix to cover the entire `/opt/data/skills/` tree, not just `auth.json` and `config.yaml`. The `enforce-fleet-routing.py` script chowns only the files it writes, but Docker layer permissions can leave other files root-owned.

---

## Quick Reference

| # | Pattern | Signal | Fix Time |
|---|---------|--------|----------|
| 17 | `auth_mode` config spam | 139× noise | Remove key from config |
| 18 | `jericho-mini` missing | 14× every restart | Install binary or remove config |
| 19 | MoA 401 cascade | 9× gateway dead | Fix openrouter auth or disable MoA |
| 20 | Goliath CAMOFOX 403 | 7× blind agent | Set CAMOFOX_API_KEY env |
| 21 | Memory store full | 8× agent stuck | Consolidate entries |
| 22 | Background review deny | 10× wasted turns | Use whitelisted tools only |
| 23 | Copilot ghp_* rejected | 12× auth noise | Generate fine-grained PAT |
| 24 | DNS resolution fail | 8× full network loss | Check /etc/resolv.conf |
| 25 | llm-wiki permission | 9× skill degraded | chown hermes:hermes |

## Version

- **Created**: 2026-07-09 00:06 UTC+4
- **Sources**: errors.log, agent.log (Jul 7-9, 2026)
- **Parent**: Module 4 patterns #1-#16
- **New patterns**: 9 (patterns #17-#25)
- **Existing patterns confirmed unchanged**: #1-#16
