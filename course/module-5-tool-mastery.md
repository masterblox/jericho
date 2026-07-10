# Module 5: Tool Mastery

**Goal**: Use every tool correctly. Know the quirks.

## Terminal

| Do | Don't |
|----|-------|
| `terminal(command=...)` for builds, git, scripts | `cat`, `grep`, `ls`, `sed`, `awk` |
| `background=true` for servers/daemons | `nohup`, `disown`, trailing `&` in foreground |
| `notify_on_complete=true` for bounded tasks | Silent background for things that end |
| `pty=true` for interactive CLI (Codex, Claude Code) | Regular mode for REPLs that need PTY |

## File Operations

| Do (tool) | Don't (terminal) |
|-----------|-----------------|
| `read_file(path)` | `cat`, `head`, `tail` |
| `search_files(pattern)` | `grep`, `rg`, `find` |
| `patch(path, old, new)` | `sed`, `awk` |
| `write_file(path, content)` | `echo`, `cat <<` |

## Cron

- `cronjob(action='list')` — Jericho only sees Jericho's crons. DEV's crons are in default gateway.
- `"30m"` = ONE-SHOT (runs once). `"every 30m"` = RECURRING. Check after creation.
- Cron jobs run in fresh sessions with no context. Prompts must be self-contained.
- After gateway restart, crons with quiet_guard need `hermes cron resume <id>` (CLI).

## Browser

- Always `browser_navigate(url)` first, then `browser_snapshot()` for refs
- Refs change between navigations — re-snapshot before clicking
- `browser_console()` checks for JS errors
- For plain-text APIs (.md, .txt, .json, .csv), use `terminal(curl)` instead — faster

## Memory

- Save durable facts: user preferences, environment quirks, stable conventions
- NEVER save: task progress, PR numbers, issue numbers, commit SHAs
- Write as declarative facts, not instructions
- Batch multiple changes in one `operations` array

## Skills

- Load with `skill_view(name)` before any matching task
- Patch with `skill_manage(action='patch')` when stale/wrong — don't wait
- Create new skills after complex tasks (5+ calls, errors overcome)
- Skills survive profile wipes — they live in shared pool

## Conductor Bridge

| Path | Who | Direction |
|------|-----|-----------|
| `jericho-handoffs/` | DEV → Jericho | Read |
| `jericho-replies/` | Jericho → DEV | Write |
| `engineer-messages/` | DEV lane | PROTECTED from Jericho |
| `iris-consults/` | Iris lane | PROTECTED from Jericho |

## CPU / Cost Awareness

- DeepSeek v4-pro cache hit rate: 95-99% on repeated context
- API latency: 2-20s per call (cache: 2-7s, non-cache: 12-20s)
- Compression: deepseek-v4-flash, threshold 0.15, target_ratio 0.25
- Never route aux/compression to GitHub Models (413 crisis history)

## Git in Non-Interactive Environments

| Do | Don't | Why |
|----|-------|-----|
| `git commit -m "message"` | `git commit` (without `-m`) | `EDITOR` is unset → interactive prompt hangs |
| `git rebase --continue` after resolving | `git rebase` without pre-set editor | Same — terminal is dumb, can't launch vim |
| Set `GIT_EDITOR=true` for merge operations | Assume editor exists | Non-interactive containers have no editor |

**Fix**: Always pass `-m` to git commit. Set `export GIT_EDITOR=true` before any rebase/merge.

## Goliath Tab Lifecycle

| Status | Meaning | Action |
|--------|---------|--------|
| `200` | Tab alive, navigate worked | Proceed |
| `404` | Tab ID invalid (never existed) | Create new tab |
| `410` | Tab expired (browser restarted) | Create new tab, never retry stale ID |
| `503` | Entire browser session expired | New session via `mcp_goliath_session(mode='open')` |

## Goliath Self-Healing Loop

Goliath is an unreliable remote service — treat it like one. Every operation:

```
mcp_goliath_session → nav → see → act → result
       ↓ (failure)
   diagnose → recover → retry fresh
```

| Error | Recovery |
|-------|----------|
| `410/404` tab gone | `mcp_goliath_session(mode='open')` |
| `503` session expired | `mcp_goliath_session(mode='open')` |
| `NS_BINDING_ABORTED` | Wait 5s, new session |
| `unreachable` (3 consecutive) | Wait 60s for auto-recovery |
| Wrong schema args | Read error, fix, retry |

**Critical**: Never retry a stale tab ID. Always `mcp_goliath_see` after nav. Diagnose error type before recovery — 503 ≠ 410. See `agent-browser` skill for calendar follow-up rule.

Distinct from browser ref staleness (#6) — these are server-side Goliath tab IDs.

## Context Compression Overload

When a session compresses 2+ times, accuracy degrades. On 2026-07-02, DEV hit 4 compressions in one session with the warning: `Session compressed 4 times — accuracy may degrade. Consider /new to start fresh.`

| Compressions | Action |
|-------------|--------|
| 1 | Normal — proceed |
| 2 | Consider `/new` after current task |
| 3+ | **Stop.** `/new` immediately. Accuracy is degraded. |

## Heredoc `&` Backgrounding False Positive

```bash
# This FAILS:
cat > file << 'EOF'
bot detection and bypass
EOF
# Error: "Foreground command uses '&' backgrounding."
```

**Why**: The terminal tool's backgrounding detector sees `&` inside heredoc content and rejects it as a backgrounding attempt. This is a false positive — the `&` is part of a string, not a shell operator.

**Workaround**: Use `execute_code` with `subprocess.run`:
```python
from hermes_tools import terminal
# Instead of heredoc, use:
subprocess.run(['tee', path], input=content, text=True)
```

## Hub-Installed / Bundled Skill Protection

Skills from the Hermes hub (`hermes skills install`) or bundled with Hermes are **read-only**. You cannot `skill_manage(action='patch')` on them:

```
Refusing background curator patch for hub-installed skill 'linear'.
Refusing background curator patch for bundled skill 'test-driven-development'.
```

**Workaround**: Copy the skill to your skills dir first:
```bash
cp -r /opt/hermes/site-packages/hermes/skills/<name> /opt/data/skills/<name>
```
Then patch the copy.

## `hermes update` Inside Docker

```
✗ `hermes update` doesn't apply inside the Docker container.
Hermes Agent runs as a published image, not a git checkout.
```

**Rule**: Never run `hermes update` from within the container. It's a no-op that can trigger gateway restart cascades (see Module 4, #13).
