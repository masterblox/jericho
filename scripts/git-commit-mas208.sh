#!/bin/bash
set -e
cd /opt/data/mas-167-work
echo "Current branch: $(git branch --show-current)"
# Stash any unrelated work
git stash --include-untracked 2>/dev/null || true
# Switch to main
git checkout main
git pull origin main 2>&1
# Create branch
git checkout -b dev/mas-208-profile-defense
# Add MAS-208 files
git add supabase/migrations/20260601000400_lock_profile_status_columns.sql
git add supabase/tests/profile_status_locked_down.sql
git add middleware.ts
git add tests/lib/middleware.test.ts
# Commit
git commit -m "[MAS-208] Defense-in-depth: lock profile.deleted_at/banned + gate sign-in on soft-delete"
# Push
git push -u origin HEAD 2>&1
echo "SUCCESS: $(git rev-parse --short HEAD)"
