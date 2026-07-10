#!/usr/bin/env bash
# Owl Protocol — disk pruning for Jericho night watch
# Safe targets only: caches, temp files, build artifacts. Never touches app data.
set -u

THRESHOLD_PCT=85
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

now() { date -u +%FT%TZ; }

# Measure before
before_pct=$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
before_gb=$(df -h / | awk 'NR==2 {print $4}')

log() { echo "[owl] $1"; }
prune() { 
    local label="$1" path="$2" before_size
    if [[ -e "$path" ]]; then
        before_size=$(du -sh "$path" 2>/dev/null | cut -f1)
    else
        before_size="0"
    fi
    if $DRY_RUN; then
        log "DRY-RUN would remove: $label ($before_size at $path)"
        return
    fi
    if rm -rf "$path" 2>/dev/null; then
        log "pruned: $label ($before_size) — $path"
    fi
}

# Only prune if we're above threshold
if (( before_pct < THRESHOLD_PCT )); then
    # Below threshold — just report, don't prune
    echo "$(now) owl=healthy disk_pct=${before_pct}% free=${before_gb} — below threshold (${THRESHOLD_PCT}%)"
    exit 0
fi

log "disk at ${before_pct}% — pruning..."

# Tier 1: Safe, instant, regeneratable
prune "npm cache (home)"            /opt/data/home/.npm/
prune "npm cache (jericho)"         /opt/data/profiles/jericho/home/.npm/
prune "Next.js build caches"        /opt/data/repos/architect-ai/.next/cache/
prune "Next.js build caches (ME)"   /opt/data/memories-express/.next/cache/
prune "Next.js build caches (LR)"   /opt/data/repos/launchrail/.next/cache/
prune "HuggingFace model cache"     /opt/data/.cache/huggingface/
prune "pip cache"                   /opt/data/home/.cache/pip/
prune "Playwright browsers"         /opt/data/.playwright-browsers/

# Tier 2: Pycache sweep
find /opt/data -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null

# Tier 3: pnpm store prune (safe — only removes unlinked packages)
if command -v pnpm &>/dev/null; then
    pnpm store prune 2>/dev/null && log "pnpm store pruned" || true
fi

# Measure after
after_pct=$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
after_gb=$(df -h / | awk 'NR==2 {print $4}')
reclaimed=$((before_pct - after_pct))

echo "$(now) owl=pruned disk_before=${before_pct}% disk_after=${after_pct}% reclaimed=${reclaimed}pct free=${after_gb}"
