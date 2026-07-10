#!/bin/bash
set -e
cd /opt/data/mas-167-work

echo "=== Current state ==="
echo "Branch: $(git branch --show-current)"
echo ""

# Check if MAS-208 files exist
echo "=== MAS-208 files ==="
for f in \
  supabase/migrations/20260601000400_lock_profile_status_columns.sql \
  supabase/tests/profile_status_locked_down.sql \
  middleware.ts \
  tests/lib/middleware.test.ts
do
  if [ -f "$f" ]; then
    echo "EXISTS: $f ($(wc -l < "$f") lines)"
  else
    echo "MISSING: $f"
  fi
done

echo ""
echo "=== Git status (short) ==="
git status --short 2>&1 | head -30
