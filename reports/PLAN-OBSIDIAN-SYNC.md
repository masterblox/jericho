# PLAN-OBSIDIAN-SYNC.md — Vault Sync Architecture

**Status:** DRAFT — awaiting Carlos review
**Date:** 2026-07-06 21:20 DXB (UTC+4)
**Author:** Jericho (fleet audit)
**Scope:** Bidirectional vault sync between Carlos's Mac Obsidian and `/opt/brain` on the VPS droplet

---

## 1. Current State: Inventory

### 1.1 Vault at `/opt/brain`

| Property | Value | Status |
|----------|-------|--------|
| Size | 213MB, ~11K markdown files | — |
| Git remote | `git@github.com:masterblox/<vault-remote>.git` (SSH) | 🔴 Broken |
| Branch | `main` | — |
| Last sync push | Jun 28, 2026 (8 days stale) | 🔴 Dead |
| Uncommitted changes | 23 files (7 modified + 16 untracked) | 🟡 Dirty |
| `.git/` ownership | `root:root` | 🔴 Blocks hermes writes |
| `.obsidian/` config | obsidian-git plugin configured (5-min auto-push) | 🟡 Desktop-only |

**Uncommitted changes:**

```
Modified (7):
  Memory/Agent/Designer/Iris General Library
  Memory/Agent/Designer/MEMORY.md
  Memory/Agent/Designer/USER.md
  Memory/Agent/Dev/MEMORY.md
  Memory/Agent/Dev/USER.md
  Memory/Agent/PA/MEMORY.md
  Memory/Agent/PA/USER.md

Untracked (16):
  10 .index.md files across vault folders
  Memory/Agent/Dev/Course/ (Agent Academy mirror, 6 files)
  Memory/Agent/Dev/Weekly Reviews/2026-07-03-weekly-review.md
  Memory/Agent/PA/Morning Briefs/ (2026-06-29.md, 2026-06-30.md)
  Memory/Agent/Dev/2026-06-29-vault-auto-detection-fix.md
  06 - Knowledge Base/Tech Docs/Fleet Health Check - 2026-06-28.md
```

### 1.2 Git Auth

| Method | Status | Detail |
|--------|--------|--------|
| SSH (`git@github.com`) | 🔴 Dead | No SSH key at `/opt/data/home/.ssh/` |
| HTTPS with token | 🟢 Working | Token from `.netrc`. HTTP 200 on <vault-remote> repo. |
| `.git/config` write | 🔴 Blocked | Owned `root:root 644` |

### 1.3 Sync Mechanisms (Current)

| Mechanism | Direction | Status |
|-----------|-----------|--------|
| Obsidian Git plugin (Mac) | Mac → GitHub | 🟡 Presumed working |
| Droplet pull | GitHub → Droplet | 🔴 NONE — no cron, no watcher |
| Droplet push | Droplet → GitHub | 🔴 NONE — agents write, never commit/push |
| Mac pull | GitHub → Mac | 🟡 Obsidian Git auto-pull every 5 min |

**Conclusion: NO active sync channel between Mac and droplet.** The vault on the droplet is 8 days stale on the pull side and has 23 uncommitted agent changes on the push side.

### 1.4 Vault Pipeline Scripts (All Intact, None Wired)

| Script | Purpose | Cron Wired? |
|--------|---------|-------------|
| `morning-synthesis.py` | DEV lane morning brief | ❌ |
| `pa-morning-synthesis.py` | PA lane morning brief | ❌ |
| `iris-morning-synthesis.py` | Iris design visibility | ❌ |
| `nightly-vault-processor.py` | Inbox filing, meetings, RAG rebuild | ❌ |
| `cron-watchdog.py` | Cross-lane cron health | ❌ |
| `weekly-review.py` | Friday review with PR velocity | ❌ |
| `vault-rag.py` | BM25 search over 11K+ notes | ❌ On-demand only |
| `cross-pollinate.py` | Hidden connection finder | ❌ |
| `argument-builder.py` | Structured evidence builder | ❌ |
| `meeting-processor.py` | Raw notes → structured | ❌ |

### 1.5 Conductor Workspaces

No Jericho or Karachi workspaces. Only `hermes/cayenne` and `memories-express-mvp-cp/muscat`.

---

## 2. The Sync Gap (Visual)

```
  Carlos's Mac                     GitHub                        VPS Droplet
  ┌──────────┐                 ┌──────────┐                 ┌──────────┐
  │ Obsidian │ ──push 5m──►    │ vault-  │                 │ /opt/    │
  │  + Git   │                 │  brain   │    ◄── NO PULL  │ brain/   │
  │  plugin  │ ◄──pull 5m──    │  repo   │                 │          │
  └──────────┘                 └──────────┘                 └──────────┘
                                                               │
                                                          NO COMMIT, NO PUSH
                                                               │
                                                          Agents write directly
                                                          to /opt/brain/
```

---

## 3. Proposed Fix: Git-Based Bidirectional Sync

### Architecture

```
  Carlos's Mac                     GitHub                        VPS Droplet
  ┌──────────┐                 ┌──────────┐                 ┌──────────┐
  │ Obsidian │ ──push 5m──►    │ vault-  │ ◄──push 10m──   │ CRON:    │
  │  + Git   │                 │  brain   │                 │ vault-   │
  │  plugin  │ ◄──pull 5m──    │  repo   │ ──pull 10m──►   │ sync.sh  │
  └──────────┘                 └──────────┘                 └──────────┘
```

Git wins over Obsidian Sync ($5/mo, another layer), rsync (fragile, needs Mac reachable), and Bridge watcher (overengineered, wrong tool).

### Three Blockers → One Cron

**Blocker 1: Fix `.git/` ownership** (Carlos, 30 sec)
```bash
# Inside Hermes container
chown -R hermes:hermes /opt/brain/.git/
```

**Blocker 2: Switch remote SSH→HTTPS** (Jericho, after blocker 1)
```bash
cd /opt/brain
GITHUB_TOKEN=$(grep -A2 "github.com" /opt/data/home/.netrc | grep password | awk '{print $2}')
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/masterblox/<vault-remote>.git"
```

**Blocker 3: Git user config** — Already set:
```
user.name = Hermes Agent (VPS)
user.email = hermes-agent@masterblox.io
```

**Cron: `vault-sync`** (every 10 minutes, `no_agent`, script-only)

Script at `/opt/data/profiles/jericho/scripts/vault-sync.sh`:
```bash
#!/bin/bash
set -e
VAULT="/opt/brain"
LOCKFILE="/tmp/vault-sync.lock"

exec 200>"$LOCKFILE"
flock -n 200 || exit 0

cd "$VAULT"
git pull origin main 2>&1 | grep -v "Already up to date" || true
git add -A

if git diff --cached --quiet; then
    exit 0  # Silent — nothing changed
fi

git commit -m "agent: vault sync $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push origin main 2>&1
echo "vault-sync: pushed $(git diff --stat HEAD~1 | tail -1)"
```

**Behavior:**
- Pulls Carlos's Mac changes every 10 min
- Commits + pushes agent changes only when there's something new
- Silent when no changes (empty stdout → cron delivers nothing)
- File-locked to prevent overlapping runs

---

## 4. Carlos's Mac: What to Verify

### 4.1 Obsidian Git Plugin
In Obsidian → Settings → Community Plugins → Obsidian Git:
- **Auto commit**: ON (every 5 min)
- **Auto push**: ON (every 5 min)
- **Auto pull**: ON (every 5 min)
- **Pull before push**: ON (recommended)

### 4.2 SSH to GitHub (if plugin push fails)
```bash
ssh -T git@github.com
# Should return: "Hi <username>! You've successfully authenticated..."
```
If broken: `ssh-keygen -t ed25519 -C "carlos@masterblox.io"` → add to GitHub SSH keys.

---

## 5. Implementation Sequence

| # | Action | Who | Time |
|---|--------|-----|------|
| 1 | Verify Obsidian Git plugin active on Mac | Carlos | 1 min |
| 2 | `chown -R hermes:hermes /opt/brain/.git/` | Carlos | 30 sec |
| 3 | Switch git remote SSH→HTTPS | Jericho | 30 sec |
| 4 | Write `vault-sync.sh` + create cron | Jericho | 2 min |
| 5 | **First sync**: commit all 23 pending + push | Jericho | 30 sec |
| 6 | Verify Mac pulls sync within 5 min | Carlos | 5 min |

---

## 6. Future: Restore Vault Pipeline Crons

Once sync is stable, 7 pipeline scripts should be re-wired:

| Cron | Script | Schedule | Priority |
|------|--------|----------|----------|
| `vault-morning-synthesis` | `morning-synthesis.py` | Daily 04:00 UTC | P1 |
| `vault-nightly-processor` | `nightly-vault-processor.py` | Daily 02:00 UTC | P1 |
| `vault-pa-morning` | `pa-morning-synthesis.py` | Daily 07:00 UTC | P2 |
| `vault-iris-morning` | `iris-morning-synthesis.py` | Daily 08:00 UTC | P2 |
| `vault-cron-watchdog` | `cron-watchdog.py` | Daily 09:00 UTC | P2 |
| `vault-weekly-review` | `weekly-review.py` | Friday 09:00 UTC | P2 |
| `vault-rag-rebuild` | `vault-rag.py index` | Daily 03:00 UTC | P2 |

---

## 7. Risk Matrix

| Risk | Severity | Mitigation |
|------|----------|------------|
| Git merge conflict | Low | Non-overlapping write zones |
| GITHUB_TOKEN expires | Low | Same token as hermes repo pushes |
| vault-sync cron dies | Medium | Delivers on every push → silence = health check |
| Obsidian Git disabled on Mac | Medium | Detectable via stale pull timestamps on droplet |
| `.netrc` rotation stale | Low | Add to token-rotation checklist |

---

## 8. Success Criteria

- [ ] Carlos edits note on Mac → appears at `/opt/brain/` within 10 min
- [ ] Agent writes to `Memory/Agent/Dev/` → appears in Carlos's Obsidian within 10 min
- [ ] `git log --oneline -5` shows alternating Mac + agent commits
- [ ] `git status` clean — zero uncommitted changes
- [ ] Vault pipeline crons re-wired (phase 2)

---

*Plan compiled by Jericho — 2026-07-06 21:20 DXB (UTC+4)*
*Next action: Carlos runs `chown -R hermes:hermes /opt/brain/.git/` → Jericho executes steps 3-6*
