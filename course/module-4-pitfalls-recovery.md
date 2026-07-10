# Module 4: Pitfalls & Recovery

**Goal**: Recognize common failure patterns and fix them fast.

Auto-updated from fleet logs every 2 days.

## Top Failure Patterns (from errors.log)

### 1. Cross-Profile / Cross-Lane Writes
```
Write denied: '/opt/conductor-bridge/outbox/jericho-handoffs/...' 
is a protected system/credential file
```
**Fix**: Write to your own outbox (`/opt/data/jericho/outbox/`), relay via Carlos.

### 2. Missing CLI Tools
```
gh: command not found
Cannot import normalize_usage — wrong Python env?
```
**Fix**: Install missing tools in your lane. Don't cross-assume tool availability.

### 3. Stream Drops on Large Context
```
Stream ended with no finish_reason while a tool call's arguments were still incomplete
```
**Root cause**: DeepSeek broken pipe on ~49K token contexts. **Fix**: Reduce context size, split large operations.

### 4. Telegram Network Unreliability
```
Telegram network error: Bad Gateway / Timed out
Reconnecting in 5s/10s/20s (exponential backoff)
```
**Pattern**: 3am-5am UTC drops. Self-healing. Gateway retries up to 10 attempts.

### 5. Skill/Curator Race Conditions
```
Refusing background curator patch: SKILL.md content has not been loaded
```
**Fix**: Call `skill_view(name)` first, then patch. Background curator requires prior load.

### 6. Browser Ref Staleness
```
Unknown ref: e25
```
**Fix**: Call `browser_snapshot()` again before clicking. Refs change between navigations.

### 7. Ghost Watchers
```
Linear inbox: 100+ identical JSON snapshots, same file size, same ticket count
```
**Diagnose**: `ps aux | grep watcher`. If no cron matches, it's a `no_agent` cron on default gateway.
**Fix**: Kill ghost process. New crons take over.

### 8. Host Watchdog Spam
```
[Hermes watchdog] FAIL container:hermes-pa-gateway:not-running
```
**Root cause**: Host systemd timer checking containers that were consolidated.
**Fix**: Patch watchdog to only check `hermes-gateway`. Route alerts to Jericho inbox, never Carlos DM.

### 9. Gateway NOT Broken But Looks Like It
When Carlos says "the gateway is fucked up" — first check:
```bash
ps aux | grep hermes  # Is gateway running?
grep -c WARNING /opt/data/logs/errors.log  # Session bloat?
```
If gateway is healthy and Carlos gets responses, the "errors" are DEV's tool errors leaking inline. Apply infra quickfixes. Do NOT restart the gateway.

### 10. npm / Permission Issues
```
Permission denied: '/root/.npm'
```
**Fix**: `npm config set prefix /opt/data/home/.npm-global` (applied 2026-07-01).

### 11. Git Auth Cascade Failure
```
git@github.com: Permission denied (publickey)
fatal: could not read Password for 'https://***@github.com'
remote: Invalid username or token
fatal: Authentication failed for 'https://github.com/...'
```
**Pattern**: Agent tries SSH → fails → tries HTTPS password → fails → tries token → fails → cycle repeats. 5 occurrences on 2026-07-02 in one session.
**Root cause**: No pre-flight git auth check. Agent doesn't know which method works.
**Fix**: Before any git push/pull, run `git ls-remote` to validate auth. Cache working method.

### 12. Goliath Tab Expiry After Browser Restart
```
POST /tabs/{id}/navigate: status 410: Tab no longer exists (browser was restarted)
POST /tabs/{id}/navigate: status 404: Tab not found
POST /tabs/open: status 503: Browser session expired
POST /tabs/{id}/navigate: NS_BINDING_ABORTED
```
**Pattern**: 7 occurrences across 48 goliath calls (Jul 1-2, 2026). Tab IDs don't survive browser restarts. Camoufox engine cycles cause transient failures.
**Recovery loop**: On 410/404/503: `mcp_goliath_session(mode='open')` → new tab → proceed. Never retry stale IDs. On `NS_BINDING_ABORTED`: wait 5s, new session. On `unreachable`: wait 60s for auto-recovery. See `agent-browser` skill for full self-healing pattern.

### 13. Gateway Restart Cascade
```
gateway.run: Shutdown context: signal=SIGTERM parent_pid=12039 parent_name=s6-supervise
```
**Pattern**: 10 SIGTERMs in 1 hour (2026-07-02 02:31-03:36 UTC+4). 5 Jericho + 2 default gateway restarts. Caused by agent executing gateway-level commands (`hermes update`, gateway restart) from within the gateway process.
**Fix**: Never run `hermes update`, gateway stop/restart, or any gateway lifecycle command from inside the container. These are Docker-image no-ops that trigger SIGTERM cascades. Wait for s6-supervise auto-restart or ask Carlos to bounce the container.

### 14. Hub-Installed / Bundled Skill Modification Attempts
```
Refusing background curator patch for hub-installed skill 'linear'.
Refusing background curator write_file for hub-installed skill 'linear'.
Refusing background curator patch for bundled skill 'test-driven-development'.
```
**Frequency**: 4 occurrences on 2026-07-04 (DEV session). 3x 'linear', 1x 'test-driven-development'.
**Root cause**: Agent tries to `skill_manage` on a skill it doesn't own. Hub-installed and bundled skills are read-only — they live in the Hermes install directory, not in `/opt/data/skills/`.
**Fix**: Only patch skills in `/opt/data/skills/` or your profile's skills directory. If you need to modify a hub/bundled skill, copy it to your skills dir first, then patch the copy.

### 15. Auxiliary Provider Cascade Failure
```
resolve_provider_client: openai-codex requested but no Codex OAuth token found
Vision provider openai-codex unavailable, falling back to auto vision backends
Auxiliary: marking openrouter unhealthy for 60s (payment / credit error)
Auxiliary Nous client unavailable: no Nous authentication found (run: hermes auth)
Auxiliary: marking nous unhealthy for 60s (payment / credit error)
→ ERROR: No LLM provider configured for task=vision
```
**Frequency**: 9 occurrences in ~30s window on 2026-07-04 (vision cascade), 22 occurrences on 2026-07-05 (broader auxiliary cascade). Each failed call cascades through ALL providers, generating 3+ error messages per attempt.
**Root cause**: Two distinct failure triggers: (1) No Codex OAuth token exists, so `openai-codex` always fails. (2) openrouter and nous prepaid credits exhausted → "payment / credit error" returned → provider marked unhealthy for 60s. Both triggers hit the same cascade. Every link logs a warning + marks unhealthy.
**Impact**: Affects ALL auxiliary calls (vision, delegation, browser vision), not just vision_analyze. The entire fallback chain is stripped when openrouter + nous are both unhealthy.
**Fix**: (1) Recharge openrouter/nous prepaid credits. (2) Set a working vision provider in config. (3) Cascade should fail fast on known-unavailable providers instead of trying all 3. Short-term: don't use auxiliary features (vision_analyze, delegate_task with vision) unless a working provider is confirmed.

### 16. Enforce-Fleet-Routing Permission Cascade
```
Failed to parse /opt/data/config.yaml: [Errno 13] Permission denied
→ Falling back to default config — every user override IGNORED
photon: could not read /opt/data/auth.json: [Errno 13] Permission denied
auth: failed to parse /opt/data/auth.json — starting with empty store. Corrupt file preserved at /opt/data/auth.json.corrupt
```
**Frequency**: 12 occurrences in 2 days (Jul 5-6, 2026). 11 auth.json denials + 1 config.yaml denial. All clustered around gateway restarts at 11:55 and 16:29 UTC+4.
**Root cause**: `enforce-fleet-routing.py` runs before gateway startup (as root/uid-10000) and writes config.yaml, changing its ownership. auth.json also gets chown'd during boot. When s6-supervise spawns the gateway running as `hermes` user, these files are unreadable → all provider auth stripped → fallback chains broken → gateway starts with empty credential store.
**Impact**: Every provider auth (OpenAI, DeepSeek, Nous, openrouter, Codex OAuth) is lost. The gateway falls back to default config — ignoring all model overrides, auxiliary providers, fallback chain, and platform settings. Telegram may fail to connect if photon platform auth is needed. The `.corrupt` backup preserves credentials but requires manual recovery.
**Fix**: `chown hermes:hermes /opt/data/auth.json /opt/data/config.yaml` after any container restart or gateway restart cascade. Verify with `ls -la` that both are readable by the hermes user. Prevention: patch `enforce-fleet-routing.py` to chown after write, or add a post-boot cont-init script.
