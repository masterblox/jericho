#!/bin/bash
# Push the local MAS-206 commit to origin/main
set -e

REPO="/opt/data/memories-express-mvp-cp"

cd "$REPO"

# Show what's in the commit
echo "=== COMMIT DIFF ==="
git diff d822829c..1e322252 --stat
echo ""
echo "=== FULL DIFF ==="
git diff d822829c..1e322252
echo ""

# Push
echo "=== PUSHING ==="
git push origin main 2>&1
echo "PUSH EXIT CODE: $?"

# Verify
echo ""
echo "=== AFTER PUSH ==="
echo "Local main: $(cat .git/refs/heads/main)"
echo "Origin main: $(cat .git/refs/remotes/origin/main)"
